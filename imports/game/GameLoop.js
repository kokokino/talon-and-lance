// Fixed-timestep game loop for rollback netcode integration
// Runs the game simulation at a fixed 60fps tick rate
// Decouples rendering from simulation (render can run at display refresh rate)

import { InputEncoder } from '../netcode/InputEncoder.js';

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

export class GameLoop {
  constructor(config) {
    const {
      session,       // RollbackSession instance
      game,          // Game simulation (must implement serialize/deserialize/tick)
      renderer,      // Renderer (must implement draw(state))
      inputReader,   // InputReader instance
      transport,     // TransportManager instance
      localPlayerIndex,
    } = config;

    this.session = session;
    this.game = game;
    this.renderer = renderer;
    this.inputReader = inputReader;
    this.transport = transport;
    this.localPlayerIndex = localPlayerIndex;

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.animationFrameId = null;

    // Event handler (set by consumer)
    this.onNetworkEvent = null;

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

  // --- Private ---

  _loop(now) {
    if (!this.running) {
      return;
    }

    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += delta;

    // Cap accumulator to prevent spiral of death (e.g., after tab was backgrounded)
    if (this.accumulator > TICK_MS * 10) {
      this.accumulator = TICK_MS * 10;
    }

    // Fixed timestep: may run multiple ticks per render frame
    while (this.accumulator >= TICK_MS) {
      this._tick();
      this.accumulator -= TICK_MS;
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

    // 4. Send local input to all peers
    const localInput = this.session.getLocalInput();
    if (localInput && this.transport) {
      const message = InputEncoder.encodeInputMessage(
        localInput.frame,
        this.localPlayerIndex,
        localInput.input
      );
      this._broadcastToAllPeers(message);
    }

    // 5. Send checksum periodically for desync detection
    const checksumData = this.session.getCurrentChecksum();
    if (checksumData) {
      // Send checksum as a quality report piggyback (or separate message)
      // For now, checksums are verified locally when remote checksums arrive
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
        // Skip frames — the session already handles this by returning empty requests
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
