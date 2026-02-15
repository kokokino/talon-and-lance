// Fixed-timestep game loop for rollback netcode integration
// Runs the game simulation at a fixed 60fps tick rate
// Decouples rendering from simulation (render can run at display refresh rate)
// Supports solo mode (no rollback) and multiplayer mode (with rollback)

import { InputEncoder } from '../netcode/InputEncoder.js';

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const INPUT_REDUNDANCY = 5;
const MAX_TICKS_PER_FRAME = 10;
const CATASTROPHIC_CAP_MS = TICK_MS * 300;

export class GameLoop {
  constructor(config) {
    const {
      game,          // Game simulation (must implement serialize/deserialize/tick)
      renderer,      // Renderer (must implement draw(state))
      inputReader,   // InputReader instance
      localPlayerIndex = 0,
    } = config;

    this.game = game;
    this.renderer = renderer;
    this.inputReader = inputReader;
    this.localPlayerIndex = localPlayerIndex;

    // Solo mode: no rollback session, direct tick
    this.soloMode = true;
    this.session = null;
    this.transport = null;

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.animationFrameId = null;

    // Recent local inputs for redundancy (packet loss resilience)
    this._recentLocalInputs = [];

    // Event handler (set by consumer)
    this.onNetworkEvent = null;

    // Message drain callback (set by MultiplayerManager)
    this.messageDrain = null;

    // Post-tick drain callback — runs AFTER the tick while-loop completes.
    // Used for peer lifecycle events (connect/disconnect) so that any
    // pending rollbacks from messageDrain resolve before activation.
    this.postTickDrain = null;

    this._loop = this._loop.bind(this);
  }

  // Start the game loop
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.animationFrameId = requestAnimationFrame(this._loop);
  }

  // Stop the game loop
  stop() {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Transition from solo mode to multiplayer mode.
   * Called when a remote player connects.
   */
  transitionToMultiplayer(session, transport) {
    this.session = session;
    this.transport = transport;
    this.soloMode = false;
    // Seed with neutral inputs so the first few packets still carry
    // INPUT_REDUNDANCY entries (packet loss resilience from frame 1)
    const seedFrame = session.currentFrame;
    this._recentLocalInputs = [];
    for (let i = 0; i < INPUT_REDUNDANCY; i++) {
      this._recentLocalInputs.push({ frame: seedFrame, input: 0 });
    }
  }

  /**
   * Return to solo mode (e.g., all remote players disconnected).
   */
  transitionToSolo() {
    this.soloMode = true;
    this.session = null;
    this.transport = null;
    this._recentLocalInputs = [];
  }

  // --- Private ---

  _loop(now) {
    if (!this.running) {
      return;
    }

    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += delta;

    // Catastrophic cap: hard-clamp after extreme durations (5 seconds).
    // Covers tab backgrounding or system sleep. Everything under 5s
    // is handled by rate-limited catch-up that preserves remainder.
    if (this.accumulator > CATASTROPHIC_CAP_MS) {
      this.accumulator = TICK_MS * MAX_TICKS_PER_FRAME;
    }

    // Drain pending network messages before running ticks so that
    // all catch-up ticks have access to the freshest confirmed inputs.
    if (this.messageDrain) {
      try {
        this.messageDrain();
      } catch (err) {
        console.error('[GameLoop] messageDrain threw:', err);
      }
    }

    // Fixed timestep: up to MAX_TICKS_PER_FRAME ticks per render frame.
    // Remainder stays in accumulator for next render frame (catch-up).
    try {
      let ticksThisFrame = 0;
      while (this.accumulator >= TICK_MS && ticksThisFrame < MAX_TICKS_PER_FRAME) {
        this._tick();
        this.accumulator -= TICK_MS;
        ticksThisFrame++;
      }
    } catch (err) {
      console.error('[GameLoop] Tick error:', err);
    }

    // Drain peer lifecycle events AFTER the tick loop so that any
    // pending rollbacks (triggered by messageDrain inputs) have resolved
    // before player activation mutates game state.
    if (this.postTickDrain) {
      try {
        this.postTickDrain();
      } catch (err) {
        console.error('[GameLoop] postTickDrain threw:', err);
      }
    }

    // Render current state (outside fixed timestep, at display refresh rate)
    if (this.renderer && this.game) {
      this.renderer.draw(this.game.state);
    }

    this.animationFrameId = requestAnimationFrame(this._loop);
  }

  _tick() {
    // 1. Sample local input
    const rawInput = this.inputReader.sample();
    const encodedInput = InputEncoder.encodeInput(rawInput);

    if (this.soloMode) {
      // Solo mode: tick directly with just local player input
      const inputs = [0, 0, 0, 0]; // 4 human slots, only local is active
      inputs[this.localPlayerIndex] = encodedInput;
      this.game.tick(inputs);
      return;
    }

    // Multiplayer mode: use rollback session
    // 2. Feed to rollback session
    this.session.addLocalInput(encodedInput);
    const requests = this.session.advanceFrame();

    // 3. Process GGRS-style requests
    for (const request of requests) {
      switch (request.type) {
        case 'SaveGameState':
          request.cell.save(this.game.serialize());
          break;
        case 'LoadGameState': {
          const state = request.cell.load();
          if (state) {
            this.game.deserialize(state);
          }
          break;
        }
        case 'AdvanceFrame':
          this.game.tick(request.inputs);
          break;
      }
    }

    // 4. Send local input to all peers (with redundancy for packet loss resilience)
    const localInput = this.session.getLocalInput();
    if (localInput && this.transport) {
      this._recentLocalInputs.push({ frame: localInput.frame, input: localInput.input });
      if (this._recentLocalInputs.length > INPUT_REDUNDANCY) {
        this._recentLocalInputs.shift();
      }

      // Build inputs array newest-first: [current, prev, prev-1, ...]
      const inputsNewestFirst = [];
      for (let i = this._recentLocalInputs.length - 1; i >= 0; i--) {
        inputsNewestFirst.push(this._recentLocalInputs[i].input);
      }

      const message = InputEncoder.encodeInputMessage(
        localInput.frame,
        this.localPlayerIndex,
        inputsNewestFirst
      );
      this._broadcastToAllPeers(message);
    }

    // 5. Send checksum periodically for desync detection
    const checksumData = this.session.getCurrentChecksum();
    if (checksumData) {
      const checksumMsg = InputEncoder.encodeChecksumMessage(
        checksumData.frame, checksumData.checksum
      );
      this._broadcastToAllPeers(checksumMsg);
    }

    // 6. Handle network events
    const events = this.session.pollEvents();
    for (const event of events) {
      this._handleNetworkEvent(event);
    }
  }

  _broadcastToAllPeers(message) {
    if (!this.transport) {
      return;
    }

    const connectionInfo = this.transport.getConnectionInfo();
    for (const peerId of Object.keys(connectionInfo)) {
      this.transport.send(peerId, message);
    }
  }

  _handleNetworkEvent(event) {
    switch (event.type) {
      case 'WaitRecommendation':
        break;

      case 'DesyncDetected':
        console.error('[GameLoop] Desync detected at frame', event.frame,
          'local:', event.localChecksum?.toString(16),
          'remote:', event.remoteChecksum?.toString(16),
          'peer:', event.peer);
        break;

      case 'Disconnected':
        console.warn('[GameLoop] Peer disconnected:', event.peer);
        break;

      case 'NetworkInterrupted':
        console.warn('[GameLoop] Network interrupted for peer:', event.peer,
          'timeout in:', event.disconnectTimeout, 'ms');
        break;

      case 'NetworkResumed':
        console.log('[GameLoop] Network resumed for peer:', event.peer);
        break;
    }

    // Forward to consumer's event handler
    if (this.onNetworkEvent) {
      this.onNetworkEvent(event);
    }
  }
}
