// Level1Scene — Joust Level 1 recreation with multi-tier rock platforms over lava.
// Player (ostrich) vs AI-controlled enemies (buzzards) with wave-based progression.
// Features: scoring, lives, HUD, egg collection, egg hatching, enemy AI.
// Receives Engine/Scene from BabylonPage — does not own them.

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem';

import { InputReader } from '../InputReader.js';
import { GameSimulation } from '../GameSimulation.js';
import { HighScoreTracker } from '../HighScoreTracker.js';
import {
  VOXEL_SIZE, ORTHO_WIDTH, ORTHO_LEFT, ORTHO_RIGHT,
  MAX_SPEED, GRAVITY, LEDGE_HEIGHT,
  TURN_DURATION, FLAP_DURATION,
  WING_UP_ANGLE, WING_DOWN_ANGLE, WING_GLIDE_ANGLE,
  SWEEP_FORWARD_ANGLE, SWEEP_BACKWARD_ANGLE, SWEEP_GLIDE_ANGLE,
  HATCH_TIME, WOBBLE_START, LOOK_AROUND_TIME, BIRD_ARRIVE_TIME,
  WAVE_TRANSITION_DELAY,
  PLATFORM_DEFS, SPAWN_POINTS,
  buildPlatformCollisionData,
  GAME_MODE_TEAM,
  EGG_RADIUS,
} from '../physics/constants.js';

// Idle animation constants
const IDLE_BLEND_IN_RATE = 2.0;
const IDLE_BLEND_OUT_RATE = 4.0;
const IDLE_VELOCITY_THRESHOLD = 0.5;
const IDLE_SETTLE_TIME = 1.5;
const IDLE_GESTURES = ['lookCamera', 'wingRuffle', 'lookAway', 'lanceAdjust'];
const IDLE_PAUSE_MIN = 0.8;
const IDLE_PAUSE_MAX = 2.5;
const IDLE_LOOK_MIN = 2.0;
const IDLE_LOOK_MAX = 3.0;
const IDLE_WING_RUFFLE_DURATION = 0.6;
const IDLE_LANCE_ADJUST_DURATION = 0.8;
const IDLE_YAW_AMOUNT = 0.8;
const IDLE_YAW_EASE_RATE = 3.0;

import {
  ENEMY_TYPE_BOUNDER,
} from '../scoring.js';
import { DeterministicRNG } from '../physics/mulberry32.js';
import { SkyBackground } from './SkyBackground.js';
import { buildRig, buildPart } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { buzzardModel } from '../voxels/models/buzzardModel.js';
import { evilKnightModel } from '../voxels/models/evilKnightModel.js';
import { eggModel } from '../voxels/models/eggModel.js';
import { buildKnightPalette } from '../voxels/models/knightPalettes.js';
import { buildEvilKnightPalette } from '../voxels/models/evilKnightPalettes.js';
import {
  MAX_HUMANS, MAX_ENEMIES, MAX_EGGS,
  HATCH_WOBBLING, HATCH_HATCHLING, WAVE_PLAYING, WAVE_TRANSITION,
} from '../physics/stateLayout.js';

/**
 * Convert a hex color string (e.g. '#FF8800') to a Babylon Color3.
 */
function hexToColor3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

/**
 * Convert a hex color string (e.g. '#FF8800') to a Babylon Color4.
 */
function hexToColor4(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color4(r, g, b, 1);
}


export class Level1Scene {
  /**
   * @param {{ audioManager: AudioManager, paletteIndex: number }} config
   */
  constructor({ audioManager, paletteIndex, onQuitToMenu, rendererOnly }) {
    this._audioManager = audioManager;
    this._paletteIndex = paletteIndex;
    this._onQuitToMenu = onQuitToMenu || null;
    this._rendererOnly = rendererOnly || false;

    this.engine = null;
    this.scene = null;

    this._inputReader = null;
    this._elapsed = 0;

    // Solo mode simulation (created in create() for non-rendererOnly mode)
    this._soloSimulation = null;

    // Escape overlay
    this._escapeOverlay = null;
    this._escapeVisible = false;
    this._escapeKeyHandler = null;

    // Banner system
    this._waveTextTimer = 0;
    this._waveBannerActive = false;

    // HUD
    this._hudUI = null;
    this._hudScoreText = null;
    this._hudLivesText = null;
    this._hudWaveText = null;
    this._hudBannerText = null;

    // Ortho bounds (Y computed from aspect ratio)
    this._orthoBottom = 0;
    this._orthoTop = 0;

    // Platform collision data (populated in _createPlatforms)
    this._platforms = [];


    // Sky background
    this._skyBackground = null;

    // Light refs for dynamic modulation
    this._ambientLight = null;
    this._dirLight = null;
    this._lavaLight = null;

    // Lava refs
    this._lavaMaterial = null;
    this._lavaTexture = null;
    this._lavaUvOffset = 0;
    this._lavaBurstTimer = 0;
    this._squawkTimer = 3 + Math.random() * 5;

    // Deterministic environment state
    this._lavaBurstRng = null;
    this._nextLavaBurstTime = 0;
    this._lastGameFrame = 0;
    this._envSeed = null;

    // ---- Renderer mode state (activated on first draw() call) ----
    this._rendererMode = false;
    this._lastDrawTime = 0;
    this._prevState = null;
    this._localPlayerSlot = 0;

    // Stride sound cooldown (ms timestamp of last play)
    this._lastStrideTime = 0;
    // Edge bump sound cooldown (ms timestamp of last play)
    this._lastEdgeBumpTime = 0;

    // Active SPS debris systems (explosions/burns in flight)
    this._activeDebrisSystems = [];

    // Per-slot render data: mesh refs + visual-only animation state
    // Indices 0-3 = humans, 4-11 = enemies
    this._renderSlots = [];
    for (let i = 0; i < 12; i++) {
      this._renderSlots.push(this._createRenderSlot());
    }

    // Per-egg-slot render data
    this._eggRenderSlots = [];
    for (let i = 0; i < 8; i++) {
      this._eggRenderSlots.push({
        rig: null,
        prevActive: false,
        prevHitLava: false,
        prevOnPlatform: false,
        prevHatchState: 0,
        // Hatchling rendering state
        hatchlingRoot: null,
        hatchlingKnightRig: null,
        hatchlingLanceRig: null,
        hatchlingLeftShoulder: null,
        hatchlingRightShoulder: null,
        hatchlingLeftHip: null,
        hatchlingRightHip: null,
        // Buzzard arrival
        buzzardArrivalRig: null,
        buzzardArrivalRoot: null,
      });
    }
  }

  /**
   * Build all scene content into the provided Scene.
   */
  create(scene, engine, canvas) {
    this.scene = scene;
    this.engine = engine;
    this.scene.clearColor = new Color4(0, 0, 0, 1);

    this._setupCamera(canvas);
    this._setupLighting();

    // Sky background — after camera, before characters
    this._skyBackground = new SkyBackground(
      this.scene, ORTHO_LEFT, ORTHO_RIGHT, this._orthoBottom, this._orthoTop
    );

    this._createPlatforms();
    this._createSpawnPads();
    this._createLava();

    // Load game SFX and start lava ambient
    if (this._audioManager) {
      this._audioManager.loadGameSfx().then(() => {
        this._audioManager?.startLavaAmbient();
      });
    }

    // Input (needed in solo mode)
    if (!this._rendererOnly) {
      this._inputReader = new InputReader();
      this._inputReader.attach(this.scene);
      this.scene.attachControl();

      // Create internal GameSimulation for solo play
      const soloSeed = Date.now() >>> 0;
      this._soloSimulation = new GameSimulation({
        gameMode: GAME_MODE_TEAM,
        seed: soloSeed,
        orthoBottom: this._orthoBottom,
        orthoTop: this._orthoTop,
      });
      this._soloSimulation.activatePlayer(0, this._paletteIndex);
      this._soloSimulation.startGame();

      // Initialize deterministic environment from solo seed
      this.setEnvironmentSeed((soloSeed ^ 0xA5A5A5A5) >>> 0);

      this._highScoreTracker = new HighScoreTracker({
        gameMode: GAME_MODE_TEAM,
        getScore: () => this._soloSimulation?.getState()?.humans?.[0]?.score ?? 0,
        getWave: () => this._soloSimulation?.getState()?.waveNumber ?? 1,
      });
      this._highScoreTracker.start().catch(() => {});
    }

    // HUD
    this._createHUD();

    // Escape key — works in both solo and renderer modes
    this._escapeKeyHandler = (event) => {
      if (event.code === 'Escape' && !event.repeat) {
        this._toggleEscapeOverlay();
      }
    };
    window.addEventListener('keydown', this._escapeKeyHandler);

    // Animation callback
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000;
      this._update(dt);
    });
  }

  /**
   * Renderer interface for GameLoop integration.
   * Accepts GameSimulation render state and updates all visuals.
   * On first call, activates renderer mode and disables internal physics loop.
   */
  draw(gameState) {
    if (!gameState || !this.scene) {
      return;
    }

    // Activate renderer mode on first call
    if (!this._rendererMode) {
      this._rendererMode = true;
      this._lastDrawTime = performance.now();
    }

    // Calculate dt for visual-only animations
    const now = performance.now();
    const dt = Math.min((now - this._lastDrawTime) / 1000, 0.05);
    this._lastDrawTime = now;

    // Sync humans
    for (const human of gameState.humans) {
      this._syncCharSlot(human, 'human', dt);
    }

    // Sync enemies
    for (const enemy of gameState.enemies) {
      this._syncCharSlot(enemy, 'enemy', dt);
    }

    // Sync eggs
    this._syncEggs(gameState.eggs, gameState.humans, dt);

    // Sync HUD
    this._syncHUD(gameState);

    // Sync banners (wave transitions, game over)
    this._syncBanners(gameState);

    // Sync sounds
    this._syncSounds(gameState);

    // Capture frame count for environment sync
    this._lastGameFrame = gameState.frame;

    // Save state snapshot for diffing on next frame
    this._prevState = this._snapshotState(gameState);
  }

  /**
   * Initialize deterministic environmental effects from a shared seed.
   * Called late (after seed is known) since in multiplayer the renderer
   * is created before matchmaking returns the seed.
   */
  setEnvironmentSeed(seed) {
    this._envSeed = seed;

    // Lava burst RNG
    this._lavaBurstRng = new DeterministicRNG(seed);
    this._nextLavaBurstTime = this._randomLavaBurstInterval();

    // Recreate sky background with seeded options
    if (this._skyBackground) {
      this._skyBackground.dispose();
    }
    if (this.scene) {
      this._skyBackground = new SkyBackground(
        this.scene, ORTHO_LEFT, ORTHO_RIGHT, this._orthoBottom, this._orthoTop,
        { envSeed: seed }
      );
    }
  }

  /**
   * Snapshot enough of gameState for next-frame diffing.
   */
  _snapshotState(gameState) {
    const humans = gameState.humans.map(h => ({
      slotIndex: h.slotIndex,
      active: h.active,
      dead: h.dead,
      materializing: h.materializing,
      isTurning: h.isTurning,
      turnTimer: h.turnTimer,
      playerState: h.playerState,
      isFlapping: h.isFlapping,
      invincible: h.invincible,
      hitLava: h.hitLava,
      score: h.score,
      lives: h.lives,
      eggsCollectedThisWave: h.eggsCollectedThisWave,
      bounceCount: h.bounceCount,
      edgeBumpCount: h.edgeBumpCount,
      strideStep: Math.floor(h.stridePhase),
      velocityX: h.velocityX,
    }));
    const enemies = gameState.enemies.map(e => ({
      slotIndex: e.slotIndex,
      active: e.active,
      dead: e.dead,
      materializing: e.materializing,
      isTurning: e.isTurning,
      turnTimer: e.turnTimer,
      playerState: e.playerState,
      isFlapping: e.isFlapping,
      invincible: e.invincible,
      hitLava: e.hitLava,
      bounceCount: e.bounceCount,
      edgeBumpCount: e.edgeBumpCount,
    }));
    const eggs = {};
    for (const egg of gameState.eggs) {
      eggs[egg.slotIndex] = {
        active: true,
        hitLava: egg.hitLava,
        hatchState: egg.hatchState,
        bounceCount: egg.bounceCount,
        onPlatform: egg.onPlatform,
      };
    }
    return {
      waveNumber: gameState.waveNumber,
      waveState: gameState.waveState,
      gameOver: gameState.gameOver,
      humans,
      enemies,
      eggs,
    };
  }

  /**
   * Core per-character renderer sync.
   * Manages mesh lifecycle (create/dispose) and drives visual animations.
   */
  _syncCharSlot(charState, type, dt) {
    const slot = this._renderSlots[charState.slotIndex];
    const prevChar = this._findPrevChar(charState.slotIndex, type);
    const prevActive = prevChar ? prevChar.active : false;
    const prevDead = prevChar ? prevChar.dead : false;

    // ---- Mesh lifecycle transitions ----

    // Rollback re-activated a player mid-vortex → cancel the vortex
    if (charState.active && slot.vortexing) {
      if (slot.vortexObserver) {
        this.scene.onBeforeRenderObservable.remove(slot.vortexObserver);
        slot.vortexObserver = null;
      }
      slot.vortexing = false;
    }

    // Character became active and alive → create meshes
    if (charState.active && !charState.dead && !slot.meshCreated) {
      this._createSlotMeshes(slot, charState, type);
      this._setCharAlpha(slot, 0);
      // Set position temporarily for particle emitter placement
      slot.positionX = charState.positionX;
      slot.positionY = charState.positionY;
      this._createMaterializeParticles(slot);
      delete slot.positionX;
      delete slot.positionY;
    }

    // Character just died → explode and dispose
    if (charState.active && charState.dead && prevActive && !prevDead && slot.meshCreated) {
      if (charState.hitLava) {
        this._lavaDeathEffect(slot, charState, type);
      } else {
        this._explodeSlotCharacter(slot, charState, type);
      }
      this._disposeSlotMeshes(slot);
    }

    // Character became inactive → dispose if meshes exist (or vortex for leaving humans)
    if (!charState.active && slot.meshCreated && !slot.vortexing) {
      if (type === 'human' && prevActive && !prevDead) {
        this._startVortexEffect(slot, charState);
      } else {
        this._disposeSlotMeshes(slot);
      }
    }

    // ---- Per-frame rendering (when alive and meshes exist) ----
    if (!charState.active || charState.dead || !slot.meshCreated) {
      return;
    }

    // Position root mesh
    if (slot.birdRig?.root) {
      slot.birdRig.root.position.x = charState.positionX;
    }

    // Detect new turn: isTurning became true or turnTimer reset
    const prevTurning = prevChar ? prevChar.isTurning : false;
    if (charState.isTurning && (!prevTurning || charState.turnTimer === 0)) {
      if (charState.facingDir === -1) {
        slot.turnFrom = 0;
        slot.turnTo = Math.PI;
      } else {
        slot.turnFrom = Math.PI;
        slot.turnTo = 0;
      }
    }

    // Materialization visual (use authoritative timer from game state, not dt)
    if (charState.materializing) {
      this._syncMaterialization(slot, charState);
      return;
    }

    // Materialization just ended — clean up particles if still active
    if (slot.materializeParticles) {
      this._setCharAlpha(slot, 1.0);
      slot.materializeParticles.stop();
      slot.materializeParticles.dispose();
      slot.materializeParticles = null;
    }

    // Update idle animation state (must run before building view so blend is current)
    this._updateIdleState(dt, slot, charState);

    // Build a merged view: prototype = slot (mesh refs), own props = physics state
    const view = Object.create(slot);
    view.positionX = charState.positionX;
    view.positionY = charState.positionY;
    view.velocityX = charState.velocityX;
    view.velocityY = charState.velocityY;
    view.playerState = charState.playerState;
    view.facingDir = charState.facingDir;
    view.isTurning = charState.isTurning;
    view.turnTimer = charState.turnTimer;
    view.stridePhase = charState.stridePhase;
    view.isFlapping = charState.isFlapping;
    view.flapTimer = charState.flapTimer;
    view.wingMode = charState.wingMode;

    // Turn animation
    this._updateTurn(dt, view);

    // Snap facing direction when not turning (ensures correct facing after rollback)
    if (!view.isTurning && slot.birdRig?.root) {
      slot.birdRig.root.rotation.y = view.facingDir === 1 ? 0 : Math.PI;
    }

    // Apply idle yaw offset additively
    if (slot.idleYawOffset !== 0 && slot.birdRig?.root) {
      slot.birdRig.root.rotation.y += slot.idleYawOffset;
    }

    // Animate character (running/flying/wings + idle)
    this._animateChar(dt, view);
  }

  /**
   * Find the previous frame's snapshot for a given slot.
   */
  _findPrevChar(slotIndex, type) {
    if (!this._prevState) {
      return null;
    }
    const list = type === 'human' ? this._prevState.humans : this._prevState.enemies;
    for (const entry of list) {
      if (entry.slotIndex === slotIndex) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Explode a render-slot character into voxel debris (cosmetic).
   */
  _explodeSlotCharacter(slot, charState, type) {
    // Build a temporary char-like object for _explodeCharacter
    const fakeChar = {
      birdRig: slot.birdRig,
      knightRig: slot.knightRig,
      lanceRig: slot.lanceRig,
      wingMode: charState.wingMode,
      enemyType: charState.enemyType,
      paletteIndex: charState.paletteIndex,
    };

    const charIdx = type === 'human' ? 0 : 1;
    this._explodeCharacter(fakeChar, charIdx);
  }

  /**
   * Lava death effect — fire-colored sinking debris, big splash, rising fire column.
   */
  _lavaDeathEffect(slot, charState, type) {
    const fakeChar = {
      birdRig: slot.birdRig,
      knightRig: slot.knightRig,
      lanceRig: slot.lanceRig,
      wingMode: charState.wingMode,
      enemyType: charState.enemyType,
      paletteIndex: charState.paletteIndex,
    };
    const charIdx = type === 'human' ? 0 : 1;
    const x = charState.positionX;
    const lavaY = this._orthoBottom + 1.2;

    this._burnCharacter(fakeChar, charIdx, lavaY);
    this._spawnLavaDeathSplash(x);
    this._spawnFireColumn(x, lavaY);
  }

  /**
   * Sync eggs from game state to egg render slots.
   */
  _syncEggs(eggs, humans, dt) {
    // Build a set of active egg slot indices this frame
    const activeSlots = new Set();
    for (const egg of eggs) {
      activeSlots.add(egg.slotIndex);
    }

    // Determine which human collected an egg this frame (if any)
    let collectorSlotIndex = -1;
    if (this._prevState) {
      for (let h = 0; h < humans.length; h++) {
        const prev = this._prevState.humans[h];
        if (prev && humans[h].eggsCollectedThisWave > prev.eggsCollectedThisWave) {
          collectorSlotIndex = h;
          break;
        }
      }
    }

    // Check for eggs that disappeared since last frame
    for (let i = 0; i < this._eggRenderSlots.length; i++) {
      const eggSlot = this._eggRenderSlots[i];
      if (eggSlot.prevActive && !activeSlots.has(i)) {
        // Egg/hatchling was removed
        if (eggSlot.prevHitLava) {
          this._spawnLavaBurst();
        } else if (eggSlot.prevHatchState !== HATCH_WOBBLING && eggSlot.prevHatchState !== HATCH_HATCHLING) {
          // Not lava, not hatching/mounting — egg was collected
          if (eggSlot.rig && eggSlot.rig.root) {
            const pos = eggSlot.rig.root.position;
            this._spawnEggCollectEffect(pos.x, pos.y, collectorSlotIndex);
          }
        } else if (eggSlot.prevHatchState === HATCH_HATCHLING && collectorSlotIndex >= 0) {
          // Hatchling was collected by a player (not mounting into enemy)
          if (eggSlot.hatchlingRoot) {
            const pos = eggSlot.hatchlingRoot.position;
            this._spawnEggCollectEffect(pos.x, pos.y, collectorSlotIndex);
          }
        }
        if (eggSlot.rig) {
          this._disposeEggRig(eggSlot.rig);
          eggSlot.rig = null;
        }
        this._disposeHatchlingMeshes(eggSlot);
        eggSlot.prevActive = false;
        eggSlot.prevHitLava = false;
        eggSlot.prevOnPlatform = false;
        eggSlot.prevHatchState = 0;
      }
    }

    // Update active eggs
    for (const egg of eggs) {
      const eggSlot = this._eggRenderSlots[egg.slotIndex];

      // Rollback handling: hatchState reverted from HATCH_HATCHLING back to earlier state
      if (eggSlot.prevHatchState === HATCH_HATCHLING && egg.hatchState !== HATCH_HATCHLING) {
        this._disposeHatchlingMeshes(eggSlot);
      }

      // Egg-to-hatchling transition
      if (egg.hatchState === HATCH_HATCHLING && eggSlot.prevHatchState !== HATCH_HATCHLING) {
        // Dispose egg rig, create hatchling meshes
        if (eggSlot.rig) {
          this._disposeEggRig(eggSlot.rig);
          eggSlot.rig = null;
        }
        this._createHatchlingMeshes(eggSlot, egg);
      }

      // Hatchling frame update
      if (egg.hatchState === HATCH_HATCHLING && eggSlot.hatchlingRoot) {
        eggSlot.hatchlingRoot.position.x = egg.positionX;
        eggSlot.hatchlingRoot.position.y = egg.positionY;

        const hatchlingAge = (egg.hatchTimer - HATCH_TIME);
        this._animateHatchlingIdle(eggSlot, hatchlingAge);

        // Buzzard arrival in the last BIRD_ARRIVE_TIME seconds
        if (hatchlingAge > LOOK_AROUND_TIME - BIRD_ARRIVE_TIME) {
          if (!eggSlot.buzzardArrivalRig) {
            this._createBuzzardArrival(eggSlot, egg);
          }
          const arrivalProgress = (hatchlingAge - (LOOK_AROUND_TIME - BIRD_ARRIVE_TIME)) / BIRD_ARRIVE_TIME;
          this._animateBuzzardArrival(eggSlot, arrivalProgress);
        }
      } else if (egg.hatchState !== HATCH_HATCHLING) {
        // Regular egg rendering
        if (!eggSlot.rig) {
          const VS = VOXEL_SIZE;
          eggSlot.rig = buildRig(this.scene, eggModel, VS, true);
        }

        if (eggSlot.rig && eggSlot.rig.root) {
          eggSlot.rig.root.position.x = egg.positionX;
          eggSlot.rig.root.position.y = egg.positionY;

          // Wobble animation
          if (egg.hatchState === HATCH_WOBBLING) {
            const wobbleProgress = (egg.hatchTimer - WOBBLE_START) / (HATCH_TIME - WOBBLE_START);
            const amplitude = 0.2 + wobbleProgress * 0.5;
            const frequency = 8 + wobbleProgress * 12;
            eggSlot.rig.root.rotation.z = Math.sin(egg.hatchTimer * frequency) * amplitude;
          } else {
            eggSlot.rig.root.rotation.z = 0;
          }
        }
      }

      eggSlot.prevActive = true;
      eggSlot.prevHitLava = egg.hitLava || false;
      eggSlot.prevOnPlatform = egg.onPlatform || false;
      eggSlot.prevHatchState = egg.hatchState || 0;
    }
  }

  /**
   * Dispose an egg rig's meshes.
   */
  _disposeEggRig(rig) {
    if (rig.root) {
      rig.root.dispose();
    }
    for (const part of Object.values(rig.parts)) {
      if (part.mesh) {
        part.mesh.dispose();
      }
    }
  }

  /**
   * Create hatchling meshes — standalone evil knight standing on platform (no bird).
   */
  _createHatchlingMeshes(eggSlot, egg) {
    const VS = VOXEL_SIZE;
    const notLit = true;
    const evilPalette = buildEvilKnightPalette(egg.enemyType);

    eggSlot.hatchlingKnightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS, notLit);
    eggSlot.hatchlingLanceRig = buildRig(this.scene, lanceModel, VS, notLit);

    // Create root transform
    eggSlot.hatchlingRoot = new TransformNode('hatchlingRoot', this.scene);
    eggSlot.hatchlingRoot.position = new Vector3(egg.positionX, egg.positionY, 0);

    // Parent knight to root — position so feet align with platform surface
    if (eggSlot.hatchlingKnightRig.root) {
      eggSlot.hatchlingKnightRig.root.parent = eggSlot.hatchlingRoot;
      eggSlot.hatchlingKnightRig.root.rotation.y = -Math.PI / 2;
      // Raise knight so feet sit at root Y (egg bottom is at positionY - EGG_RADIUS)
      eggSlot.hatchlingKnightRig.root.position = new Vector3(0, EGG_RADIUS, 0);
    }

    // Set up shoulder pivots (same pattern as _setupKnightShoulders)
    const kParts = eggSlot.hatchlingKnightRig.parts;
    if (kParts.leftArm && kParts.torso) {
      eggSlot.hatchlingLeftShoulder = new TransformNode('hatchLeftShoulder', this.scene);
      eggSlot.hatchlingLeftShoulder.parent = kParts.torso.mesh;
      eggSlot.hatchlingLeftShoulder.position = new Vector3(3 * VS, 4 * VS, 0);
      kParts.leftArm.mesh.parent = eggSlot.hatchlingLeftShoulder;
      kParts.leftArm.mesh.position = new Vector3(0, -4 * VS, 0);
      eggSlot.hatchlingLeftShoulder.rotation.x = Math.PI / 2;
      if (kParts.shield) {
        kParts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (kParts.rightArm && kParts.torso) {
      eggSlot.hatchlingRightShoulder = new TransformNode('hatchRightShoulder', this.scene);
      eggSlot.hatchlingRightShoulder.parent = kParts.torso.mesh;
      eggSlot.hatchlingRightShoulder.position = new Vector3(-3 * VS, 4 * VS, 0);
      kParts.rightArm.mesh.parent = eggSlot.hatchlingRightShoulder;
      kParts.rightArm.mesh.position = new Vector3(0, -4 * VS, 0);
      eggSlot.hatchlingRightShoulder.rotation.x = Math.PI / 2;
    }

    // Set up hip pivots — standing pose (legs straight down, not riding position)
    if (kParts.leftLeg && kParts.torso) {
      eggSlot.hatchlingLeftHip = new TransformNode('hatchLeftHip', this.scene);
      eggSlot.hatchlingLeftHip.parent = kParts.torso.mesh;
      eggSlot.hatchlingLeftHip.position = new Vector3(1 * VS, 0, 0);
      kParts.leftLeg.mesh.parent = eggSlot.hatchlingLeftHip;
      kParts.leftLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      // Standing: legs straight down (rotation.x = 0), not riding (Math.PI / 2.5)
    }

    if (kParts.rightLeg && kParts.torso) {
      eggSlot.hatchlingRightHip = new TransformNode('hatchRightHip', this.scene);
      eggSlot.hatchlingRightHip.parent = kParts.torso.mesh;
      eggSlot.hatchlingRightHip.position = new Vector3(-1 * VS, 0, 0);
      kParts.rightLeg.mesh.parent = eggSlot.hatchlingRightHip;
      kParts.rightLeg.mesh.position = new Vector3(0, -6 * VS, 0);
    }

    // Parent lance to right arm
    if (eggSlot.hatchlingLanceRig.root && kParts.rightArm) {
      eggSlot.hatchlingLanceRig.root.parent = kParts.rightArm.mesh;
      eggSlot.hatchlingLanceRig.root.position = new Vector3(0, 0, 0);
      eggSlot.hatchlingLanceRig.root.rotation.x = Math.PI;
    }
  }

  /**
   * Animate hatchling idle — knight-only idle (head look-around, body sway, arm adjustments).
   */
  _animateHatchlingIdle(eggSlot, hatchlingAge) {
    const kParts = eggSlot.hatchlingKnightRig.parts;

    // Head: slow sinusoidal Y rotation ±45°
    if (kParts.head && kParts.head.mesh) {
      kParts.head.mesh.rotation.y = Math.sin(hatchlingAge * 2.5) * (Math.PI / 4);
    }

    // Body: subtle Z sway
    if (eggSlot.hatchlingKnightRig.root) {
      eggSlot.hatchlingKnightRig.root.rotation.z = Math.sin(hatchlingAge * 1.5) * 0.03;
    }

    // Lance arm (right shoulder): slight Z oscillation
    if (eggSlot.hatchlingRightShoulder) {
      eggSlot.hatchlingRightShoulder.rotation.z = Math.sin(hatchlingAge * 1.8) * 0.05;
    }

    // Shield arm (left shoulder): guard shift
    if (eggSlot.hatchlingLeftShoulder) {
      eggSlot.hatchlingLeftShoulder.rotation.z = 0.1 + Math.sin(hatchlingAge * 1.2) * 0.04;
    }
  }

  /**
   * Create buzzard rig for the swoop-in arrival animation.
   */
  _createBuzzardArrival(eggSlot, egg) {
    const VS = VOXEL_SIZE;
    eggSlot.buzzardArrivalRig = buildRig(this.scene, buzzardModel, VS, true);
    eggSlot.buzzardArrivalRoot = new TransformNode('buzzardArrivalRoot', this.scene);

    if (eggSlot.buzzardArrivalRig.root) {
      eggSlot.buzzardArrivalRig.root.parent = eggSlot.buzzardArrivalRoot;
    }

    // Start position: above the hatchling
    eggSlot.buzzardArrivalRoot.position = new Vector3(
      egg.positionX,
      egg.positionY + 3.0,
      0
    );
  }

  /**
   * Animate buzzard swooping down toward hatchling.
   */
  _animateBuzzardArrival(eggSlot, progress) {
    if (!eggSlot.buzzardArrivalRoot || !eggSlot.hatchlingRoot) {
      return;
    }

    const t = Math.min(progress, 1.0);
    // Ease-in: quadratic
    const eased = t * t;

    const targetX = eggSlot.hatchlingRoot.position.x;
    const targetY = eggSlot.hatchlingRoot.position.y + EGG_RADIUS;
    const startY = targetY + 3.0;

    eggSlot.buzzardArrivalRoot.position.x = targetX;
    eggSlot.buzzardArrivalRoot.position.y = startY + (targetY - startY) * eased;

    // Wing flap during descent
    const bParts = eggSlot.buzzardArrivalRig.parts;
    const flapAngle = Math.sin(progress * 12) * 0.6;
    if (bParts.leftWing && bParts.leftWing.mesh) {
      bParts.leftWing.mesh.rotation.z = flapAngle;
    }
    if (bParts.rightWing && bParts.rightWing.mesh) {
      bParts.rightWing.mesh.rotation.z = -flapAngle;
    }
  }

  /**
   * Dispose all hatchling-specific meshes on an egg slot.
   */
  _disposeHatchlingMeshes(eggSlot) {
    const nodes = [
      eggSlot.hatchlingLeftShoulder, eggSlot.hatchlingRightShoulder,
      eggSlot.hatchlingLeftHip, eggSlot.hatchlingRightHip,
    ];
    for (const node of nodes) {
      if (node) {
        node.dispose();
      }
    }

    const rigs = [eggSlot.hatchlingKnightRig, eggSlot.hatchlingLanceRig, eggSlot.buzzardArrivalRig];
    for (const rig of rigs) {
      if (rig) {
        for (const part of Object.values(rig.parts)) {
          if (part.mesh) {
            part.mesh.dispose();
          }
        }
        if (rig.root) {
          rig.root.dispose();
        }
      }
    }

    if (eggSlot.buzzardArrivalRoot) {
      eggSlot.buzzardArrivalRoot.dispose();
    }
    if (eggSlot.hatchlingRoot) {
      eggSlot.hatchlingRoot.dispose();
    }

    eggSlot.hatchlingRoot = null;
    eggSlot.hatchlingKnightRig = null;
    eggSlot.hatchlingLanceRig = null;
    eggSlot.hatchlingLeftShoulder = null;
    eggSlot.hatchlingRightShoulder = null;
    eggSlot.hatchlingLeftHip = null;
    eggSlot.hatchlingRightHip = null;
    eggSlot.buzzardArrivalRig = null;
    eggSlot.buzzardArrivalRoot = null;
  }

  /**
   * Update HUD from game state (renderer mode).
   */
  _syncHUD(gameState) {
    const localPlayer = gameState.humans[this._localPlayerSlot];
    if (localPlayer && localPlayer.active) {
      if (this._hudScoreText) {
        this._hudScoreText.text = String(localPlayer.score).padStart(6, '0');
      }
      if (this._hudLivesText) {
        this._hudLivesText.text = 'x' + localPlayer.lives;
      }
    }
    if (this._hudWaveText) {
      this._hudWaveText.text = 'WAVE ' + gameState.waveNumber;
    }
  }

  /**
   * Detect wave transitions and game over to show banners (renderer mode).
   */
  _syncBanners(gameState) {
    if (!this._prevState) {
      return;
    }

    // Wave number changed → show wave banner
    if (gameState.waveNumber !== this._prevState.waveNumber) {
      this._showBanner('WAVE ' + gameState.waveNumber, WAVE_TRANSITION_DELAY, null);
    }

    // Game over transition (all players eliminated)
    if (gameState.gameOver && !this._prevState.gameOver) {
      this._showBanner('GAME OVER', 3, () => {
        if (this._onQuitToMenu) {
          this._onQuitToMenu();
        }
      });
    }

    // Local player eliminated in multiplayer (other players still alive)
    if (this._rendererMode && !gameState.gameOver) {
      const localHuman = gameState.humans[this._localPlayerSlot];
      const prevLocal = this._findPrevChar(this._localPlayerSlot, 'human');
      if (localHuman && prevLocal && localHuman.dead && !prevLocal.dead && localHuman.lives <= 0) {
        this._showBanner('GAME OVER', 3, () => {
          if (this._onQuitToMenu) {
            this._onQuitToMenu();
          }
        });
      }
    }
  }

  // ---- Sound trigger system ----

  /**
   * Diff current vs previous game state and trigger appropriate SFX.
   * Called once per visual frame after _syncBanners, before _snapshotState.
   */
  _syncSounds(gameState) {
    if (!this._prevState || !this._audioManager) {
      return;
    }

    // Characters
    for (const human of gameState.humans) {
      const prev = this._findPrevChar(human.slotIndex, 'human');
      if (prev) {
        this._syncCharSounds(human, prev, 'human');
      }
    }
    for (const enemy of gameState.enemies) {
      const prev = this._findPrevChar(enemy.slotIndex, 'enemy');
      if (prev) {
        this._syncCharSounds(enemy, prev, 'enemy');
      }
    }

    // Eggs
    this._syncEggSounds(gameState.eggs);

    // Progression
    this._syncProgressionSounds(gameState);
  }

  _syncCharSounds(char, prev, type) {
    // Materialization start
    if (char.active && !prev.active && char.materializing) {
      if (type === 'human') {
        this._audioManager.playSfx('materialize');
      } else {
        this._audioManager.playSfx('enemy-materialize');
      }
    }

    // Death
    if (char.dead && !prev.dead) {
      if (char.hitLava) {
        this._audioManager.playSfx('lava-death');
      } else {
        this._audioManager.playSfx('death-explode');
        this._audioManager.playSfx('joust-kill');
      }
    }

    // Vortex leave (human became inactive while alive — disconnected player)
    if (!char.active && prev.active && !prev.dead && type === 'human') {
      this._audioManager.playSfx('vortex-suck');
    }

    // Materialization end
    if (prev.materializing && !char.materializing) {
      this._audioManager.playSfx('materialize-done');
    }

    // Skip remaining sounds for dead/materializing/inactive characters
    if (!char.active || char.dead || char.materializing) {
      return;
    }

    // Flap
    if (char.isFlapping && !prev.isFlapping) {
      this._audioManager.playSfx('flap', 5);
    }

    // Landing
    if (char.playerState === 'GROUNDED' && prev.playerState === 'AIRBORNE') {
      this._audioManager.playSfx('land', 3);
    }

    // Skid
    if (char.isTurning && !prev.isTurning && char.playerState === 'GROUNDED') {
      this._audioManager.playSfx('skid');
    }

    // Joust bounce
    if (char.bounceCount > prev.bounceCount) {
      this._audioManager.playSfx('joust-bounce', 2);
    }

    // Edge bump (platform side collision, with cooldown to prevent overlap)
    if (char.edgeBumpCount > prev.edgeBumpCount) {
      const now = performance.now();
      if (now - this._lastEdgeBumpTime >= 300) {
        this._audioManager.playSfx('edge-bump');
        this._lastEdgeBumpTime = now;
      }
    }

    // Invincibility end (humans only)
    if (type === 'human' && prev.invincible && !char.invincible) {
      this._audioManager.playSfx('invincible-end');
    }

    // Stride footstep (humans only, with cooldown to prevent overlap)
    if (type === 'human' && char.playerState === 'GROUNDED' &&
        char.strideStep !== prev.strideStep && Math.abs(char.velocityX) > 0.5) {
      const now = performance.now();
      if (now - this._lastStrideTime >= 300) {
        this._audioManager.playSfx('stride', 3);
        this._lastStrideTime = now;
      }
    }

    // Extra life (humans only)
    if (type === 'human' && char.lives > prev.lives) {
      this._audioManager.playSfx('extra-life');
    }

    // Score tick (humans only)
    if (type === 'human' && char.score > prev.score) {
      this._audioManager.playSfx('score-tick');
    }

    // Idle squawk (humans only, grounded, near-zero velocity)
    if (type === 'human' && char.playerState === 'GROUNDED' &&
        Math.abs(char.velocityX) < 0.5 && !char.materializing) {
      this._squawkTimer -= 1 / 60;
      if (this._squawkTimer <= 0) {
        this._audioManager.playSfx('squawk', 2);
        this._squawkTimer = 4 + Math.random() * 8;
      }
    } else if (type === 'human') {
      this._squawkTimer = 3 + Math.random() * 5;
    }
  }

  _syncEggSounds(eggs) {
    // Build set of active egg slots this frame
    const currentEggs = {};
    for (const egg of eggs) {
      currentEggs[egg.slotIndex] = egg;
    }

    // Check for eggs that disappeared
    for (let i = 0; i < MAX_EGGS; i++) {
      const prevEgg = this._prevState.eggs[i];
      if (prevEgg && prevEgg.active && !currentEggs[i]) {
        if (prevEgg.hitLava) {
          this._audioManager.playSfx('egg-lava');
        } else if (prevEgg.hatchState === HATCH_WOBBLING) {
          this._audioManager.playSfx('egg-hatch');
        } else if (prevEgg.hatchState === HATCH_HATCHLING) {
          // Hatchling collected or mounted — collect sound for collection
          this._audioManager.playSfx('egg-collect');
        } else if (!prevEgg.onPlatform) {
          this._audioManager.playSfx('egg-catch-air');
        } else {
          this._audioManager.playSfx('egg-collect');
        }
      }
    }

    // Check for new eggs and state changes
    for (const egg of eggs) {
      const prevEgg = this._prevState.eggs[egg.slotIndex];

      // New egg appeared
      if (!prevEgg) {
        this._audioManager.playSfx('egg-drop');
        continue;
      }

      // Bounce count increased
      if (egg.bounceCount > prevEgg.bounceCount) {
        this._audioManager.playSfx('egg-bounce', 2);
      }

      // Started wobbling
      if (egg.hatchState === HATCH_WOBBLING && prevEgg.hatchState !== HATCH_WOBBLING) {
        this._audioManager.playSfx('egg-wobble');
      }
    }
  }

  _syncProgressionSounds(gameState) {
    // Wave number changed
    if (gameState.waveNumber !== this._prevState.waveNumber) {
      this._audioManager.playSfx('wave-start');
    }

    // Wave completed (PLAYING -> TRANSITION)
    if (gameState.waveState === WAVE_TRANSITION && this._prevState.waveState === WAVE_PLAYING) {
      this._audioManager.playSfx('wave-complete');
      this._audioManager.playSfx('crowd-cheer');
      // Survival bonus for local player
      const localPlayer = gameState.humans[this._localPlayerSlot];
      if (localPlayer && localPlayer.active && !localPlayer.dead) {
        this._audioManager.playSfx('survival-bonus');
      }
    }

    // Game over
    if (gameState.gameOver && !this._prevState.gameOver) {
      this._audioManager.playSfx('game-over');
    }
  }

  /**
   * Drive materialization visual from authoritative game state timer.
   * Does not advance the timer — reads directly from charState.
   */
  _syncMaterialization(slot, charState) {
    const progress = Math.min(charState.materializeTimer / charState.materializeDuration, 1.0);
    const ps = slot.materializeParticles;

    if (progress < 0.8) {
      const phase1Progress = progress / 0.8;
      const boxSizeX = 0.7 - phase1Progress * 0.6;
      const boxSizeY = 1.0 - phase1Progress * 0.9;

      if (ps) {
        ps.minEmitBox.x = -boxSizeX;
        ps.minEmitBox.y = -boxSizeY;
        ps.maxEmitBox.x = boxSizeX;
        ps.maxEmitBox.y = boxSizeY;
        ps.emitRate = 20 + phase1Progress * 130;
      }
      this._setCharAlpha(slot, 0);
    } else {
      const phase2Progress = (progress - 0.8) / 0.2;

      if (ps) {
        ps.minEmitBox.x = -0.1;
        ps.minEmitBox.y = -0.1;
        ps.maxEmitBox.x = 0.1;
        ps.maxEmitBox.y = 0.1;
        ps.emitRate = Math.max(0, 200 * (1 - phase2Progress));
      }
      this._setCharAlpha(slot, phase2Progress);
    }
  }

  dispose() {
    this._audioManager?.stopLavaAmbient();
    if (this._escapeKeyHandler) {
      window.removeEventListener('keydown', this._escapeKeyHandler);
      this._escapeKeyHandler = null;
    }
    if (this._inputReader) {
      this._inputReader.detach();
      this._inputReader = null;
    }
    if (this._highScoreTracker) {
      this._highScoreTracker.stop();
      this._highScoreTracker = null;
    }
    this._soloSimulation = null;
    if (this._skyBackground) {
      this._skyBackground.dispose();
      this._skyBackground = null;
    }
    this._hideEscapeOverlay();
    if (this._hudUI) {
      this._hudUI.dispose();
      this._hudUI = null;
    }
    // Dispose renderer mode render slots
    for (const slot of this._renderSlots) {
      if (slot.vortexObserver) {
        this.scene?.onBeforeRenderObservable?.remove(slot.vortexObserver);
        slot.vortexObserver = null;
        slot.vortexing = false;
      }
      if (slot.meshCreated) {
        this._disposeSlotMeshes(slot);
      }
    }
    // Dispose renderer mode egg slots
    for (const eggSlot of this._eggRenderSlots) {
      if (eggSlot.rig) {
        this._disposeEggRig(eggSlot.rig);
        eggSlot.rig = null;
      }
      this._disposeHatchlingMeshes(eggSlot);
    }
    // Dispose any in-flight debris SPS systems
    for (const entry of this._activeDebrisSystems) {
      if (entry.observer) {
        this.scene?.onBeforeRenderObservable?.remove(entry.observer);
      }
      if (entry.sps) {
        entry.sps.dispose();
      }
      if (entry.mat) {
        entry.mat.dispose();
      }
    }
    this._activeDebrisSystems = [];

    this._platforms = [];
    this._lavaMaterial = null;
    this._lavaTexture = null;
    this._lavaLight = null;
    this.scene = null;
    this.engine = null;
  }

  // ---- Setup ----

  _setupCamera(canvas) {
    const camera = new FreeCamera('level1Camera', new Vector3(0, 0, -10), this.scene);
    camera.setTarget(new Vector3(0, 0, 0));
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

    const aspect = canvas.width / canvas.height;
    const orthoHalfHeight = (ORTHO_WIDTH / 2) / aspect;

    camera.orthoLeft = ORTHO_LEFT;
    camera.orthoRight = ORTHO_RIGHT;
    camera.orthoBottom = -orthoHalfHeight;
    camera.orthoTop = orthoHalfHeight;

    this._orthoBottom = -orthoHalfHeight;
    this._orthoTop = orthoHalfHeight;
    this._camera = camera;
  }

  _setupLighting() {
    this._ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    this._ambientLight.intensity = 0.6;
    this._ambientLight.diffuse = new Color3(0.9, 0.9, 1.0);
    this._ambientLight.groundColor = new Color3(0.2, 0.2, 0.3);

    this._dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, 1), this.scene);
    this._dirLight.intensity = 0.8;
    this._dirLight.diffuse = new Color3(1.0, 0.95, 0.85);

    // Lava glow from below
    this._lavaLight = new PointLight('lavaLight', new Vector3(0, this._orthoBottom, 0), this.scene);
    this._lavaLight.intensity = 0.4;
    this._lavaLight.diffuse = new Color3(1.0, 0.4, 0.1);
    this._lavaLight.range = 15;
  }

  _modulateLighting(timeOfDay) {
    const dayBrightness = Math.sin(timeOfDay * Math.PI);
    const ambientMin = 0.25;
    const ambientMax = 0.7;
    const dirMin = 0.15;
    const dirMax = 0.9;

    if (this._ambientLight) {
      this._ambientLight.intensity = ambientMin + (ambientMax - ambientMin) * dayBrightness;
    }
    if (this._dirLight) {
      this._dirLight.intensity = dirMin + (dirMax - dirMin) * dayBrightness;
    }
  }

  // ---- Platforms ----

  _createPlatforms() {
    this._platforms = buildPlatformCollisionData();

    for (const def of PLATFORM_DEFS) {
      // Main platform body
      const body = MeshBuilder.CreateBox(`plat_${def.id}`, {
        width: def.width,
        height: def.height,
        depth: 2,
      }, this.scene);
      body.position = new Vector3(def.x, def.y, 0);

      const mat = new StandardMaterial(`plat_${def.id}_mat`, this.scene);
      mat.diffuseColor = new Color3(0.45, 0.40, 0.35);
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
      body.material = mat;

      // Thin metallic ledge/lip on top
      const ledge = MeshBuilder.CreateBox(`ledge_${def.id}`, {
        width: def.width + 0.1,
        height: LEDGE_HEIGHT,
        depth: 2,
      }, this.scene);
      ledge.position = new Vector3(def.x, def.y + def.height / 2 + LEDGE_HEIGHT / 2, -0.01);

      const ledgeMat = new StandardMaterial(`ledge_${def.id}_mat`, this.scene);
      ledgeMat.diffuseColor = new Color3(0.6, 0.58, 0.55);
      ledgeMat.specularColor = new Color3(0.3, 0.3, 0.3);
      ledgeMat.emissiveColor = new Color3(0.08, 0.07, 0.06);
      ledge.material = ledgeMat;
    }
  }

  _createSpawnPads() {
    for (const sp of SPAWN_POINTS) {
      const platform = this._platforms.find(p => p.id === sp.platformId);
      if (!platform) {
        continue;
      }

      const padHeight = 4 * VOXEL_SIZE;
      const pad = MeshBuilder.CreateBox(`spawnPad_${sp.platformId}`, {
        width: 1.5,
        height: padHeight,
        depth: 2,
      }, this.scene);
      pad.position = new Vector3(sp.x, platform.top - padHeight / 2, -0.02);

      const mat = new StandardMaterial(`spawnPadMat_${sp.platformId}`, this.scene);
      mat.diffuseColor = new Color3(0.82, 0.71, 0.55);
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      mat.emissiveColor = new Color3(0.08, 0.07, 0.05);
      pad.material = mat;
    }
  }

  // ---- Lava ----

  _createLava() {
    const lavaWidth = ORTHO_WIDTH + 4;
    const lavaHeight = 2.0;
    const lavaY = this._orthoBottom + lavaHeight / 2 + 0.1;

    const lava = MeshBuilder.CreatePlane('lava', {
      width: lavaWidth,
      height: lavaHeight,
    }, this.scene);
    lava.position = new Vector3(0, lavaY, 0.5);

    // Procedural lava texture
    const lavaTexture = new DynamicTexture('lavaTex', 256, this.scene, false);
    const ctx = lavaTexture.getContext();
    this._drawLavaPattern(ctx, 256);
    lavaTexture.update();
    lavaTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    lavaTexture.wrapV = Texture.WRAP_ADDRESSMODE;

    const lavaMat = new StandardMaterial('lavaMat', this.scene);
    lavaMat.diffuseTexture = lavaTexture;
    lavaMat.emissiveColor = new Color3(0.8, 0.25, 0.05);
    lavaMat.specularColor = new Color3(0, 0, 0);
    lavaMat.backFaceCulling = false;
    lava.material = lavaMat;

    this._lavaMaterial = lavaMat;
    this._lavaTexture = lavaTexture;
    this._lavaBurstTimer = 0.5;
  }

  _drawLavaPattern(ctx, size) {
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const nx = x / size;
        const ny = y / size;
        const noise = (
          Math.sin(nx * 12.0 + ny * 8.0) * 0.3 +
          Math.sin(nx * 5.0 - ny * 15.0) * 0.2 +
          Math.sin((nx + ny) * 20.0) * 0.15 +
          0.5
        );
        const clamped = Math.max(0, Math.min(1, noise));

        data[idx] = Math.floor(120 + clamped * 135);
        data[idx + 1] = Math.floor(20 + clamped * 120);
        data[idx + 2] = Math.floor(5 + clamped * 25);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _spawnLavaBurst() {
    this._audioManager?.playSfx('lava-burst', 2);
    const tex = new DynamicTexture('lavaBurstTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 200, 50, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 100, 20, 0.8)');
    gradient.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('lavaBurst', 30, this.scene);
    ps.particleTexture = tex;

    // Random X across screen width; Y at lava surface
    const rand1 = this._lavaBurstRng ? this._lavaBurstRng.next() : Math.random();
    const rand2 = this._lavaBurstRng ? this._lavaBurstRng.next() : Math.random();
    const x = (rand1 - 0.5) * (ORTHO_WIDTH + 2);
    const lavaY = this._orthoBottom + 1.2;
    ps.emitter = new Vector3(x, lavaY, 0.4);

    // Particles shoot upward
    ps.direction1 = new Vector3(-0.3, 2, 0);
    ps.direction2 = new Vector3(0.3, 5, 0);
    ps.gravity = new Vector3(0, -6, 0);

    ps.minSize = 0.08;
    ps.maxSize = 0.25;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;

    ps.emitRate = 40;
    ps.manualEmitCount = 12 + Math.floor(rand2 * 10);

    ps.color1 = new Color4(1.0, 0.8, 0.2, 1);
    ps.color2 = new Color4(1.0, 0.4, 0.1, 1);
    ps.colorDead = new Color4(0.5, 0.1, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 0.15;
    ps.disposeOnStop = true;
    ps.start();
  }

  _createMaterializeParticles(char) {
    const tex = new DynamicTexture('matTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 215, 64, 0.9)');
    gradient.addColorStop(1, 'rgba(255, 180, 50, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('materialize', 150, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(char.positionX, char.positionY, 0);

    // Start with character-sized emit box
    ps.minEmitBox = new Vector3(-0.7, -0.7, -0.3);
    ps.maxEmitBox = new Vector3(0.7, 0.7, 0.3);

    ps.direction1 = new Vector3(-0.5, -0.5, 0);
    ps.direction2 = new Vector3(0.5, 0.5, 0);
    ps.gravity = new Vector3(0, 0, 0);

    ps.minSize = 0.04;
    ps.maxSize = 0.08;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;
    ps.emitRate = 20;

    ps.color1 = new Color4(1.0, 1.0, 1.0, 1.0);
    ps.color2 = new Color4(1.0, 0.85, 0.25, 1.0);
    ps.colorDead = new Color4(1.0, 0.7, 0.2, 0.0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();

    char.materializeParticles = ps;
  }

  _setCharAlpha(char, alpha) {
    const rigs = [char.birdRig, char.knightRig, char.lanceRig];
    for (const rig of rigs) {
      if (!rig) {
        continue;
      }
      for (const part of Object.values(rig.parts)) {
        if (part.mesh && part.mesh.material) {
          part.mesh.material.alpha = alpha;
          if (alpha < 1.0) {
            part.mesh.material.transparencyMode = 2; // ALPHA_BLEND
          } else {
            part.mesh.material.transparencyMode = 0; // OPAQUE
          }
        }
      }
    }
  }

  _setSlotEmissive(slot, color) {
    const rigs = [slot.birdRig, slot.knightRig, slot.lanceRig];
    for (const rig of rigs) {
      if (!rig) {
        continue;
      }
      for (const part of Object.values(rig.parts)) {
        if (part.mesh && part.mesh.material) {
          part.mesh.material.emissiveColor = color;
        }
      }
    }
  }

  _findClosestHumanSlot(eggX, eggY) {
    let closest = null;
    let closestDist = Infinity;
    for (let i = 0; i < MAX_HUMANS; i++) {
      const slot = this._renderSlots[i];
      if (!slot.birdRig || !slot.birdRig.root) {
        continue;
      }
      const pos = slot.birdRig.root.position;
      const dx = pos.x - eggX;
      const dy = pos.y - eggY;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closest = slot;
      }
    }
    return closest;
  }

  _spawnEggCollectEffect(x, y, collectorSlotIndex) {
    // Part A — Gold sparkle particles
    const tex = new DynamicTexture('eggCollectTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 200, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 215, 0, 0.9)');
    gradient.addColorStop(1, 'rgba(255, 180, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('eggCollect', 25, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(x, y, 0.4);

    ps.direction1 = new Vector3(-0.8, 1.5, 0);
    ps.direction2 = new Vector3(0.8, 3.0, 0);
    ps.gravity = new Vector3(0, -2, 0);

    ps.minSize = 0.04;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;

    ps.emitRate = 80;
    ps.manualEmitCount = 25;

    ps.color1 = new Color4(1.0, 1.0, 0.7, 1);
    ps.color2 = new Color4(1.0, 0.85, 0.2, 1);
    ps.colorDead = new Color4(1.0, 0.7, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 0.3;
    ps.disposeOnStop = true;
    ps.start();

    // Part B — Golden glow on the human who actually collected the egg
    const slot = collectorSlotIndex >= 0
      ? this._renderSlots[collectorSlotIndex]
      : this._findClosestHumanSlot(x, y);
    if (!slot) {
      return;
    }

    // Capture original emissive colors
    const originals = [];
    const rigs = [slot.birdRig, slot.knightRig, slot.lanceRig];
    for (const rig of rigs) {
      if (!rig) {
        continue;
      }
      for (const part of Object.values(rig.parts)) {
        if (part.mesh && part.mesh.material) {
          originals.push({
            material: part.mesh.material,
            color: part.mesh.material.emissiveColor.clone(),
          });
        }
      }
    }

    // Apply golden tint
    this._setSlotEmissive(slot, new Color3(1.0, 0.85, 0.3));

    // Lerp back to original over 0.8s
    const duration = 0.8;
    let elapsed = 0;
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      elapsed += this.scene.getEngine().getDeltaTime() / 1000;
      const t = Math.min(elapsed / duration, 1.0);
      for (const entry of originals) {
        entry.material.emissiveColor = Color3.Lerp(
          new Color3(1.0, 0.85, 0.3),
          entry.color,
          t
        );
      }
      if (t >= 1.0) {
        this.scene.onBeforeRenderObservable.remove(observer);
      }
    });
  }

  // ---- Character assembly ----

  _assembleCharacter(char, VS) {
    const bParts = char.birdRig.parts;
    const kParts = char.knightRig.parts;

    this._setupBirdLegPivots(char, bParts, VS);
    this._setupBirdWingPivots(char, bParts, VS);
    this._setupKnightShoulders(char, kParts, VS);
    this._setupKnightHipPivots(char, kParts, VS);

    // Parent lance to right arm
    if (char.lanceRig.root && kParts.rightArm) {
      char.lanceRig.root.parent = kParts.rightArm.mesh;
      char.lanceRig.root.position = new Vector3(0, 0, 0);
      char.lanceRig.root.rotation.x = Math.PI;
    }

    // Mount knight on bird
    if (char.knightRig.root && bParts.body) {
      char.knightRig.root.parent = bParts.body.mesh;
      char.knightRig.root.rotation.y = -Math.PI / 2;
      char.knightMountY = 5 * VS;
      char.knightRig.root.position = new Vector3(-1 * VS, char.knightMountY, 0);
    }
  }

  _setupBirdLegPivots(char, bParts, VS) {
    if (bParts.leftThigh && bParts.body) {
      char.leftHipPivot = new TransformNode('leftHipPivot', this.scene);
      char.leftHipPivot.parent = bParts.body.mesh;
      char.leftHipPivot.position = new Vector3(-1 * VS, 0, 1 * VS);
      bParts.leftThigh.mesh.parent = char.leftHipPivot;
      bParts.leftThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (bParts.leftShin && bParts.leftThigh) {
      char.leftKneePivot = new TransformNode('leftKneePivot', this.scene);
      char.leftKneePivot.parent = bParts.leftThigh.mesh;
      char.leftKneePivot.position = new Vector3(0, 0, 0);
      bParts.leftShin.mesh.parent = char.leftKneePivot;
      bParts.leftShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }

    if (bParts.rightThigh && bParts.body) {
      char.rightHipPivot = new TransformNode('rightHipPivot', this.scene);
      char.rightHipPivot.parent = bParts.body.mesh;
      char.rightHipPivot.position = new Vector3(-1 * VS, 0, -1 * VS);
      bParts.rightThigh.mesh.parent = char.rightHipPivot;
      bParts.rightThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (bParts.rightShin && bParts.rightThigh) {
      char.rightKneePivot = new TransformNode('rightKneePivot', this.scene);
      char.rightKneePivot.parent = bParts.rightThigh.mesh;
      char.rightKneePivot.position = new Vector3(0, 0, 0);
      bParts.rightShin.mesh.parent = char.rightKneePivot;
      bParts.rightShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }
  }

  _setupBirdWingPivots(char, bParts, VS) {
    if (bParts.leftWing && bParts.body) {
      char.leftWingPivot = new TransformNode('leftWingPivot', this.scene);
      char.leftWingPivot.parent = bParts.body.mesh;
      char.leftWingPivot.position = new Vector3(0, 4 * VS, 3 * VS);
      bParts.leftWing.mesh.parent = char.leftWingPivot;
      bParts.leftWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }

    if (bParts.rightWing && bParts.body) {
      char.rightWingPivot = new TransformNode('rightWingPivot', this.scene);
      char.rightWingPivot.parent = bParts.body.mesh;
      char.rightWingPivot.position = new Vector3(0, 4 * VS, -3 * VS);
      bParts.rightWing.mesh.parent = char.rightWingPivot;
      bParts.rightWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }
  }

  _setupKnightShoulders(char, kParts, VS) {
    if (kParts.leftArm && kParts.torso) {
      char.leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      char.leftShoulderNode.parent = kParts.torso.mesh;
      char.leftShoulderNode.position = new Vector3(3 * VS, 4 * VS, 0);
      kParts.leftArm.mesh.parent = char.leftShoulderNode;
      kParts.leftArm.mesh.position = new Vector3(0, -4 * VS, 0);
      char.leftShoulderNode.rotation.x = Math.PI / 2;
      if (kParts.shield) {
        kParts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (kParts.rightArm && kParts.torso) {
      char.rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      char.rightShoulderNode.parent = kParts.torso.mesh;
      char.rightShoulderNode.position = new Vector3(-3 * VS, 4 * VS, 0);
      kParts.rightArm.mesh.parent = char.rightShoulderNode;
      kParts.rightArm.mesh.position = new Vector3(0, -4 * VS, 0);
      char.rightShoulderNode.rotation.x = Math.PI / 2;
    }
  }

  _setupKnightHipPivots(char, kParts, VS) {
    if (kParts.leftLeg && kParts.torso) {
      char.leftHipNode = new TransformNode('knightLeftHip', this.scene);
      char.leftHipNode.parent = kParts.torso.mesh;
      char.leftHipNode.position = new Vector3(1 * VS, 0, 0);
      kParts.leftLeg.mesh.parent = char.leftHipNode;
      kParts.leftLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      char.leftHipNode.rotation.x = Math.PI / 2.5;
    }

    if (kParts.rightLeg && kParts.torso) {
      char.rightHipNode = new TransformNode('knightRightHip', this.scene);
      char.rightHipNode.parent = kParts.torso.mesh;
      char.rightHipNode.position = new Vector3(-1 * VS, 0, 0);
      kParts.rightLeg.mesh.parent = char.rightHipNode;
      kParts.rightLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      char.rightHipNode.rotation.x = Math.PI / 2.5;
    }
  }

  // ---- Render slot helpers ----

  _createRenderSlot() {
    return {
      meshCreated: false,
      birdRig: null,
      knightRig: null,
      lanceRig: null,
      leftShoulderNode: null,
      rightShoulderNode: null,
      leftHipNode: null,
      rightHipNode: null,
      leftHipPivot: null,
      rightHipPivot: null,
      leftKneePivot: null,
      rightKneePivot: null,
      leftWingPivot: null,
      rightWingPivot: null,
      knightMountY: 0,
      materializeParticles: null,
      // Renderer-local turn animation state
      turnFrom: 0,
      turnTo: 0,
      // Vortex leave effect
      vortexing: false,
      vortexObserver: null,
      // Idle animation state
      idleTime: 0,
      idleBlend: 0,
      idlePhase: 'none',
      idlePhaseTimer: 0,
      idlePhaseDuration: 0,
      idleYawOffset: 0,
      idleTargetYaw: 0,
      idleGestureIndex: 0,
    };
  }

  _createSlotMeshes(slot, charState, type) {
    const VS = VOXEL_SIZE;
    const notLit = true;

    if (type === 'human') {
      slot.birdRig = buildRig(this.scene, ostrichModel, VS, notLit);
      const mergedPalette = buildKnightPalette(charState.paletteIndex);
      slot.knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VS, notLit);
      slot.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    } else {
      slot.birdRig = buildRig(this.scene, buzzardModel, VS, notLit);
      const evilPalette = buildEvilKnightPalette(charState.enemyType);
      slot.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS, notLit);
      slot.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    }

    this._assembleCharacter(slot, VS);

    if (slot.birdRig.root) {
      slot.birdRig.root.position = new Vector3(charState.positionX, charState.positionY, 0);
    }

    slot.meshCreated = true;
  }

  _disposeSlotMeshes(slot) {
    if (slot.materializeParticles) {
      slot.materializeParticles.stop();
      slot.materializeParticles.dispose();
      slot.materializeParticles = null;
    }

    const nodes = [
      slot.leftHipPivot, slot.rightHipPivot,
      slot.leftKneePivot, slot.rightKneePivot,
      slot.leftWingPivot, slot.rightWingPivot,
      slot.leftShoulderNode, slot.rightShoulderNode,
      slot.leftHipNode, slot.rightHipNode,
    ];
    for (const node of nodes) {
      if (node) {
        node.dispose();
      }
    }

    const rigs = [slot.birdRig, slot.knightRig, slot.lanceRig];
    for (const rig of rigs) {
      if (rig) {
        for (const part of Object.values(rig.parts)) {
          if (part.mesh) {
            part.mesh.dispose();
          }
        }
        if (rig.root) {
          rig.root.dispose();
        }
      }
    }

    slot.birdRig = null;
    slot.knightRig = null;
    slot.lanceRig = null;
    slot.leftShoulderNode = null;
    slot.rightShoulderNode = null;
    slot.leftHipNode = null;
    slot.rightHipNode = null;
    slot.leftHipPivot = null;
    slot.rightHipPivot = null;
    slot.leftKneePivot = null;
    slot.rightKneePivot = null;
    slot.leftWingPivot = null;
    slot.rightWingPivot = null;
    slot.knightMountY = 0;
    slot.meshCreated = false;
    // Reset idle animation state
    slot.idleTime = 0;
    slot.idleBlend = 0;
    slot.idlePhase = 'none';
    slot.idlePhaseTimer = 0;
    slot.idlePhaseDuration = 0;
    slot.idleYawOffset = 0;
    slot.idleTargetYaw = 0;
    slot.idleGestureIndex = 0;
  }

  // ---- Update loop ----

  _update(dt) {
    this._elapsed += dt;

    // Compute gameTime from frame count (deterministic across clients)
    let gameTime;
    if (this._soloSimulation) {
      const state = this._soloSimulation.getState();
      if (state) {
        gameTime = state.frame / 60;
      }
    } else if (this._lastGameFrame > 0) {
      gameTime = this._lastGameFrame / 60;
    }

    // Cosmetic updates (run in all modes)
    if (this._skyBackground) {
      this._skyBackground.update(dt, gameTime);
      this._modulateLighting(this._skyBackground.timeOfDay);
    }
    this._animateLava(dt, gameTime);
    this._updateBanner(dt);

    // Solo mode: tick internal simulation and sync rendering
    if (this._soloSimulation) {
      const input = this._inputReader
        ? this._inputReader.sample()
        : { left: false, right: false, flap: false };
      const encoded = (input.left ? 0x01 : 0) | (input.right ? 0x02 : 0) | (input.flap ? 0x04 : 0);
      this._soloSimulation.tick([encoded]);
      const state = this._soloSimulation.getState();
      if (state) {
        // Sync humans
        for (const human of state.humans) {
          this._syncCharSlot(human, 'human', dt);
        }
        // Sync enemies
        for (const enemy of state.enemies) {
          this._syncCharSlot(enemy, 'enemy', dt);
        }
        // Sync eggs
        this._syncEggs(state.eggs, state.humans, dt);
        // Sync HUD
        this._syncHUD(state);
        // Sync banners
        this._syncBanners(state);
        // Sync sounds
        this._syncSounds(state);
        // Save state for next-frame diffing
        this._prevState = this._snapshotState(state);
      }
    }
    // Renderer mode (external draw() provides state) — cosmetic updates only
  }

  _updateTurn(dt, char) {
    if (!char.isTurning || !char.birdRig?.root) {
      return;
    }

    char.turnTimer += dt;
    let t = char.turnTimer / TURN_DURATION;
    if (t >= 1.0) {
      t = 1.0;
      char.isTurning = false;
    }

    const easedT = 0.5 - 0.5 * Math.cos(t * Math.PI);
    char.birdRig.root.rotation.y = char.turnFrom + (char.turnTo - char.turnFrom) * easedT;
  }

  // ---- Idle state machine ----

  _updateIdleState(dt, slot, charState) {
    const isIdle = charState.playerState === 'GROUNDED' &&
      Math.abs(charState.velocityX) < IDLE_VELOCITY_THRESHOLD &&
      !charState.materializing && !charState.isTurning;

    if (isIdle) {
      slot.idleBlend = Math.min(1.0, slot.idleBlend + IDLE_BLEND_IN_RATE * dt);
      slot.idleTime += dt;
      this._advanceIdlePhase(dt, slot);
    } else {
      slot.idleBlend = Math.max(0.0, slot.idleBlend - IDLE_BLEND_OUT_RATE * dt);
      if (slot.idleBlend === 0) {
        slot.idleTime = 0;
        slot.idlePhase = 'none';
        slot.idlePhaseTimer = 0;
        slot.idlePhaseDuration = 0;
        slot.idleTargetYaw = 0;
        slot.idleGestureIndex = 0;
      }
    }

    // Smoothly ease yaw offset toward target (scaled by blend)
    const targetYaw = slot.idleTargetYaw * slot.idleBlend;
    const yawDiff = targetYaw - slot.idleYawOffset;
    slot.idleYawOffset += yawDiff * Math.min(1.0, IDLE_YAW_EASE_RATE * dt);
  }

  _advanceIdlePhase(dt, slot) {
    slot.idlePhaseTimer += dt;

    if (slot.idlePhase === 'none') {
      slot.idlePhase = 'settle';
      slot.idlePhaseTimer = 0;
      slot.idlePhaseDuration = IDLE_SETTLE_TIME;
      slot.idleTargetYaw = 0;
      return;
    }

    if (slot.idlePhaseTimer < slot.idlePhaseDuration) {
      return;
    }

    // Phase completed — advance to next
    if (slot.idlePhase === 'settle' || slot.idlePhase === 'pause') {
      // Move to next gesture
      const gesture = IDLE_GESTURES[slot.idleGestureIndex];
      slot.idlePhase = gesture;
      slot.idlePhaseTimer = 0;

      if (gesture === 'lookCamera') {
        slot.idlePhaseDuration = IDLE_LOOK_MIN + Math.random() * (IDLE_LOOK_MAX - IDLE_LOOK_MIN);
        slot.idleTargetYaw = IDLE_YAW_AMOUNT;
      } else if (gesture === 'lookAway') {
        slot.idlePhaseDuration = IDLE_LOOK_MIN + Math.random() * (IDLE_LOOK_MAX - IDLE_LOOK_MIN);
        slot.idleTargetYaw = -IDLE_YAW_AMOUNT;
      } else if (gesture === 'wingRuffle') {
        slot.idlePhaseDuration = IDLE_WING_RUFFLE_DURATION;
      } else if (gesture === 'lanceAdjust') {
        slot.idlePhaseDuration = IDLE_LANCE_ADJUST_DURATION;
      }
    } else {
      // Gesture completed — go to pause, advance gesture index
      slot.idlePhase = 'pause';
      slot.idlePhaseTimer = 0;
      slot.idlePhaseDuration = IDLE_PAUSE_MIN + Math.random() * (IDLE_PAUSE_MAX - IDLE_PAUSE_MIN);
      slot.idleGestureIndex = (slot.idleGestureIndex + 1) % IDLE_GESTURES.length;
    }
  }

  // ---- Animation ----

  _animateChar(dt, char) {
    this._animateWingFlap(dt, char);

    if (char.playerState === 'GROUNDED') {
      this._animateRunning(dt, char);
      if (char.idleBlend > 0) {
        this._animateIdle(dt, char);
      }
    } else {
      this._animateFlying(dt, char);
    }
  }

  _animateIdle(dt, char) {
    const blend = char.idleBlend;
    const t = this._elapsed;
    const bParts = char.birdRig?.parts;
    const kParts = char.knightRig?.parts;

    if (!bParts) {
      return;
    }

    // --- Continuous background animations ---

    // Body breathing bob
    if (bParts.body) {
      bParts.body.mesh.position.y += Math.sin(t * (2 * Math.PI / 3)) * 0.03 * blend;
    }

    // Body weight shift (= not += because _animateRunning never touches body rotation.z)
    if (bParts.body) {
      bParts.body.mesh.rotation.z = Math.sin(t * (2 * Math.PI / 5)) * 0.012 * blend;
    }

    // Neck bob
    if (bParts.neck) {
      bParts.neck.mesh.rotation.z += Math.sin(t * (2 * Math.PI / 2.5)) * 0.06 * blend;
    }

    // Tail wag
    if (bParts.tail) {
      bParts.tail.mesh.rotation.z += Math.sin(t * (2 * Math.PI / 4)) * 0.08 * blend;
    }

    // Leg bend synced with weight shift
    const legBend = Math.sin(t * (2 * Math.PI / 5)) * 0.03 * blend;
    if (char.leftHipPivot) {
      char.leftHipPivot.rotation.z += legBend;
    }
    if (char.rightHipPivot) {
      char.rightHipPivot.rotation.z += -legBend;
    }

    // Knight continuous animations
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y += Math.sin(t * (2 * Math.PI / 3)) * 0.015 * blend;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z += Math.sin(t * (2 * Math.PI / 4)) * 0.025 * blend;
      }
      if (char.leftShoulderNode) {
        char.leftShoulderNode.rotation.z += Math.sin(t * (2 * Math.PI / 3.5)) * 0.02 * blend;
      }
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z += Math.sin(t * (2 * Math.PI / 3.5) + 0.5) * 0.02 * blend;
      }
    }

    // --- Phase-driven gesture animations ---

    const phase = char.idlePhase;
    const phaseTimer = char.idlePhaseTimer;
    const phaseDuration = char.idlePhaseDuration;

    if (phase === 'lookCamera' || phase === 'lookAway') {
      // Neck look-around during look phases
      if (bParts.neck) {
        const progress = phaseDuration > 0 ? phaseTimer / phaseDuration : 0;
        const envelope = Math.sin(progress * Math.PI);
        bParts.neck.mesh.rotation.y = envelope * 0.15 * (phase === 'lookCamera' ? 1 : -1) * blend;
      }
    }

    if (phase === 'wingRuffle') {
      const progress = phaseDuration > 0 ? phaseTimer / phaseDuration : 0;
      const flare = Math.sin(progress * Math.PI) * 0.3 * blend;
      if (char.leftWingPivot) {
        char.leftWingPivot.rotation.z += flare;
      }
      if (char.rightWingPivot) {
        char.rightWingPivot.rotation.z += -flare;
      }
    }

    if (phase === 'lanceAdjust' && kParts) {
      const progress = phaseDuration > 0 ? phaseTimer / phaseDuration : 0;
      const dip = Math.sin(progress * Math.PI) * 0.15 * blend;
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z += dip;
      }
    }
  }

  _animateRunning(dt, char) {
    const speedRatio = Math.abs(char.velocityX) / MAX_SPEED;
    const bParts = char.birdRig?.parts;
    const kParts = char.knightRig?.parts;

    if (!bParts) {
      return;
    }

    const strideFreq = speedRatio * 2.0;
    char.stridePhase += strideFreq * dt;

    const p = char.stridePhase * Math.PI * 2;
    const amp = speedRatio;

    const HIP_AMP = 0.8;
    const KNEE_BASE = 0.3;
    const KNEE_AMP = 0.5;

    if (char.leftHipPivot) {
      char.leftHipPivot.rotation.z = Math.sin(p) * HIP_AMP * amp;
      char.leftHipPivot.position.y = 0;
    }
    if (char.rightHipPivot) {
      char.rightHipPivot.rotation.z = Math.sin(p + Math.PI) * HIP_AMP * amp;
      char.rightHipPivot.position.y = 0;
    }
    if (char.leftKneePivot) {
      char.leftKneePivot.rotation.z = (KNEE_BASE - Math.cos(p) * KNEE_AMP) * amp;
    }
    if (char.rightKneePivot) {
      char.rightKneePivot.rotation.z = (KNEE_BASE - Math.cos(p + Math.PI) * KNEE_AMP) * amp;
    }

    // Body: vertical bob at double stride frequency
    if (bParts.body) {
      const bobAmount = Math.abs(Math.sin(p * 2)) * 0.05 * amp;
      bParts.body.mesh.position.y = char.positionY + bobAmount;
    }

    // Neck: forward-back bob
    if (bParts.neck) {
      bParts.neck.mesh.rotation.z = Math.sin(p) * 0.12 * amp;
    }

    // Wings: tucked with slight bounce
    const wingBounce = Math.abs(Math.sin(p * 2)) * 0.08 * amp;
    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.z = wingBounce;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.z = -wingBounce;
    }

    // Tail: slight wag
    if (bParts.tail) {
      bParts.tail.mesh.rotation.z = Math.sin(p * 1.5) * 0.1 * amp;
    }

    // Knight: subtle bounce + arm sway
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = char.knightMountY + Math.abs(Math.sin(p * 2)) * 0.02 * amp;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = Math.sin(p) * 0.03 * amp;
      }
      if (char.leftShoulderNode) {
        char.leftShoulderNode.rotation.z = Math.sin(p + 0.5) * 0.04 * amp;
      }
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z = Math.sin(p - 0.5) * 0.04 * amp;
      }
    }
  }

  _animateWingFlap(dt, char) {
    if (char.isFlapping) {
      char.flapTimer += dt;
      if (char.flapTimer >= FLAP_DURATION) {
        char.isFlapping = false;
        char.flapTimer = 0;
      }
    }

    if (char.wingMode === 'updown') {
      this._animateWingFlapUpDown(char);
    } else {
      this._animateWingFlapSweep(char);
    }
  }

  _animateWingFlapUpDown(char) {
    let flapAngle = 0;

    if (char.isFlapping) {
      const t = char.flapTimer / FLAP_DURATION;

      if (t < 0.3) {
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        flapAngle = eased * WING_UP_ANGLE;
      } else if (t < 0.7) {
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_UP_ANGLE + eased * (WING_DOWN_ANGLE - WING_UP_ANGLE);
      } else {
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_DOWN_ANGLE + eased * (0 - WING_DOWN_ANGLE);
      }
    } else if (char.playerState === 'AIRBORNE') {
      flapAngle = WING_GLIDE_ANGLE;
    }

    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.x = flapAngle;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.x = -flapAngle;
    }
  }

  _animateWingFlapSweep(char) {
    let sweepAngle = 0;

    if (char.isFlapping) {
      const t = char.flapTimer / FLAP_DURATION;

      if (t < 0.3) {
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        sweepAngle = eased * SWEEP_FORWARD_ANGLE;
      } else if (t < 0.7) {
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_FORWARD_ANGLE + eased * (SWEEP_BACKWARD_ANGLE - SWEEP_FORWARD_ANGLE);
      } else {
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_BACKWARD_ANGLE + eased * (0 - SWEEP_BACKWARD_ANGLE);
      }
    } else if (char.playerState === 'AIRBORNE') {
      sweepAngle = SWEEP_GLIDE_ANGLE;
    }

    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.z = sweepAngle;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.z = sweepAngle;
    }
  }

  _animateFlying(dt, char) {
    const bParts = char.birdRig?.parts;
    const kParts = char.knightRig?.parts;

    if (!bParts) {
      return;
    }

    if (bParts.body) {
      bParts.body.mesh.position.y = char.positionY;
    }

    if (bParts.neck) {
      bParts.neck.mesh.rotation.z = 0.1;
    }

    if (bParts.tail) {
      bParts.tail.mesh.rotation.z = -0.15;
    }

    if (char.wingMode === 'updown') {
      if (char.leftWingPivot) {
        char.leftWingPivot.rotation.z = 0;
      }
      if (char.rightWingPivot) {
        char.rightWingPivot.rotation.z = 0;
      }
    }

    this._animateTuckedLegs(char);

    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = char.knightMountY;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = 0;
      }
      if (char.leftShoulderNode) {
        char.leftShoulderNode.rotation.z = 0;
      }
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z = 0;
      }
    }
  }

  _animateTuckedLegs(char) {
    const pivotValue = 2.6;
    const tuckLift = 2 * VOXEL_SIZE;
    if (char.leftHipPivot) {
      char.leftHipPivot.rotation.z = pivotValue;
      char.leftHipPivot.position.y = tuckLift;
    }
    if (char.rightHipPivot) {
      char.rightHipPivot.rotation.z = pivotValue;
      char.rightHipPivot.position.y = tuckLift;
    }
    if (char.leftKneePivot) {
      char.leftKneePivot.rotation.z = -pivotValue;
    }
    if (char.rightKneePivot) {
      char.rightKneePivot.rotation.z = -pivotValue;
    }
  }

  // ---- Lava animation ----

  _animateLava(dt, gameTime) {
    if (!this._lavaMaterial) {
      return;
    }

    // Emissive intensity pulse
    const pulse = 0.6 + Math.sin(this._elapsed * (2 * Math.PI / 4)) * 0.2;
    this._lavaMaterial.emissiveColor = new Color3(pulse, pulse * 0.3, pulse * 0.06);

    // UV scroll
    if (this._lavaMaterial.diffuseTexture) {
      this._lavaUvOffset += dt * 0.02;
      this._lavaMaterial.diffuseTexture.uOffset = this._lavaUvOffset;
      this._lavaMaterial.diffuseTexture.vOffset = this._lavaUvOffset * 0.7;
    }

    // Lava burst spawning
    if (gameTime !== undefined && this._lavaBurstRng) {
      // Deterministic: gameTime-based scheduling
      if (gameTime >= this._nextLavaBurstTime) {
        this._spawnLavaBurst();
        this._nextLavaBurstTime = gameTime + this._randomLavaBurstInterval();
      }
    } else {
      // Fallback: dt accumulation
      this._lavaBurstTimer -= dt;
      if (this._lavaBurstTimer <= 0) {
        this._spawnLavaBurst();
        this._lavaBurstTimer = 0.4 + Math.random() * 1.1;
      }
    }
  }

  _randomLavaBurstInterval() {
    if (this._lavaBurstRng) {
      return 0.4 + this._lavaBurstRng.next() * 1.1;
    }
    return 0.4 + Math.random() * 1.1;
  }

  // ---- Escape overlay ----

  _toggleEscapeOverlay() {
    if (this._escapeVisible) {
      this._hideEscapeOverlay();
    } else {
      this._showEscapeOverlay();
    }
  }

  _showEscapeOverlay() {
    if (this._escapeVisible || !this.scene) {
      return;
    }
    this._escapeVisible = true;

    // Lazy-import GUI to avoid bundling when not needed
    import('@babylonjs/gui/2D/advancedDynamicTexture').then(({ AdvancedDynamicTexture }) => {
      import('@babylonjs/gui/2D/controls').then(({ Rectangle, TextBlock, StackPanel, Button }) => {
        if (!this._escapeVisible || !this.scene) {
          return;
        }

        const ui = AdvancedDynamicTexture.CreateFullscreenUI('escapeUI', true, this.scene);
        this._escapeOverlay = ui;

        // Semi-transparent background
        const bg = new Rectangle('escapeBg');
        bg.width = 1;
        bg.height = 1;
        bg.background = 'rgba(0, 0, 0, 0.6)';
        bg.thickness = 0;
        ui.addControl(bg);

        // Center panel
        const panel = new StackPanel('escapePanel');
        panel.width = '300px';
        panel.verticalAlignment = 1; // center
        bg.addControl(panel);

        // Title
        const title = new TextBlock('escapeTitle', 'PAUSED');
        title.color = '#FFD700';
        title.fontSize = 36;
        title.fontFamily = 'monospace';
        title.height = '60px';
        panel.addControl(title);

        // Resume button
        const resumeBtn = Button.CreateSimpleButton('resumeBtn', 'Resume');
        resumeBtn.width = '200px';
        resumeBtn.height = '50px';
        resumeBtn.color = 'white';
        resumeBtn.background = '#444';
        resumeBtn.cornerRadius = 8;
        resumeBtn.fontSize = 20;
        resumeBtn.fontFamily = 'monospace';
        resumeBtn.paddingTop = '10px';
        resumeBtn.onPointerUpObservable.add(() => {
          this._hideEscapeOverlay();
        });
        panel.addControl(resumeBtn);

        // Quit button
        const quitBtn = Button.CreateSimpleButton('quitBtn', 'Quit to Menu');
        quitBtn.width = '200px';
        quitBtn.height = '50px';
        quitBtn.color = 'white';
        quitBtn.background = '#822';
        quitBtn.cornerRadius = 8;
        quitBtn.fontSize = 20;
        quitBtn.fontFamily = 'monospace';
        quitBtn.paddingTop = '10px';
        quitBtn.onPointerUpObservable.add(() => {
          this._hideEscapeOverlay();
          if (this._onQuitToMenu) {
            this._onQuitToMenu();
          }
        });
        panel.addControl(quitBtn);
      });
    });
  }

  _hideEscapeOverlay() {
    this._escapeVisible = false;
    if (this._escapeOverlay) {
      this._escapeOverlay.dispose();
      this._escapeOverlay = null;
    }
  }

  // ---- HUD ----

  _createHUD() {
    import('@babylonjs/gui/2D/advancedDynamicTexture').then(({ AdvancedDynamicTexture }) => {
      import('@babylonjs/gui/2D/controls').then(({ TextBlock }) => {
        if (!this.scene) {
          return;
        }

        const ui = AdvancedDynamicTexture.CreateFullscreenUI('hud', true, this.scene);
        this._hudUI = ui;

        // Score — top right
        const scoreText = new TextBlock('score', '000000');
        scoreText.color = '#FFFFFF';
        scoreText.fontSize = 28;
        scoreText.fontFamily = 'monospace';
        scoreText.textHorizontalAlignment = 1; // right
        scoreText.textVerticalAlignment = 0; // top
        scoreText.top = '10px';
        scoreText.left = '-15px';
        scoreText.horizontalAlignment = 1; // right
        scoreText.verticalAlignment = 0; // top
        ui.addControl(scoreText);
        this._hudScoreText = scoreText;

        // Lives — top left
        const livesText = new TextBlock('lives', 'x' + this._lives);
        livesText.color = '#FFFFFF';
        livesText.fontSize = 28;
        livesText.fontFamily = 'monospace';
        livesText.textHorizontalAlignment = 0; // left
        livesText.textVerticalAlignment = 0; // top
        livesText.top = '10px';
        livesText.left = '15px';
        livesText.horizontalAlignment = 0; // left
        livesText.verticalAlignment = 0; // top
        ui.addControl(livesText);
        this._hudLivesText = livesText;

        // Wave — top center
        const waveText = new TextBlock('wave', 'WAVE 1');
        waveText.color = '#FFD700';
        waveText.fontSize = 22;
        waveText.fontFamily = 'monospace';
        waveText.textHorizontalAlignment = 2; // center
        waveText.textVerticalAlignment = 0; // top
        waveText.top = '10px';
        waveText.horizontalAlignment = 2; // center
        waveText.verticalAlignment = 0; // top
        ui.addControl(waveText);
        this._hudWaveText = waveText;

        // Center banner (for WAVE X, GAME OVER text)
        const banner = new TextBlock('banner', '');
        banner.color = '#FFD700';
        banner.fontSize = 48;
        banner.fontFamily = 'monospace';
        banner.textHorizontalAlignment = 2;
        banner.textVerticalAlignment = 2;
        banner.alpha = 0;
        ui.addControl(banner);
        this._hudBannerText = banner;
      });
    });
  }

  _showBanner(text, duration, callback) {
    if (!this._hudBannerText) {
      if (callback) {
        setTimeout(callback, duration * 1000);
      }
      return;
    }
    this._hudBannerText.text = text;
    this._hudBannerText.alpha = 1;
    this._waveBannerActive = true;
    this._waveTextTimer = duration;
    this._bannerCallback = callback || null;
  }

  _updateBanner(dt) {
    if (!this._waveBannerActive) {
      return;
    }
    this._waveTextTimer -= dt;
    // Fade out in last 0.5s
    if (this._waveTextTimer < 0.5 && this._hudBannerText) {
      this._hudBannerText.alpha = Math.max(0, this._waveTextTimer / 0.5);
    }
    if (this._waveTextTimer <= 0) {
      this._waveBannerActive = false;
      if (this._hudBannerText) {
        this._hudBannerText.alpha = 0;
      }
      if (this._bannerCallback) {
        this._bannerCallback();
        this._bannerCallback = null;
      }
    }
  }

  // ---- Vortex Leave Effect ----

  _startVortexEffect(slot, charState) {
    slot.vortexing = true;
    const startTime = performance.now();
    const SPIN_DURATION = 0.7;
    const TOTAL_DURATION = SPIN_DURATION;

    // Capture center position for feather spawn
    const centerX = slot.birdRig?.root ? slot.birdRig.root.position.x : charState.positionX;
    const centerY = slot.birdRig?.root ? slot.birdRig.root.position.y : charState.positionY;

    // Feather debris state (spawned at end of spin phase)
    let featherDebris = null;
    let featherParents = null;
    let meshesDisposed = false;

    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const frameDt = this.engine.getDeltaTime() / 1000;

      // Phase 1: Spin + Shrink
      if (elapsed < SPIN_DURATION && !meshesDisposed) {
        const progress = elapsed / SPIN_DURATION;
        const spinSpeed = (10 + progress * 30) * frameDt;
        const scale = Math.max(0.01, 1 - progress);

        const rigs = [slot.birdRig, slot.knightRig, slot.lanceRig];
        for (const rig of rigs) {
          if (rig?.root) {
            rig.root.rotation.y += spinSpeed;
            rig.root.scaling.setAll(scale);
          }
        }

        // Slight upward drift
        if (slot.birdRig?.root) {
          slot.birdRig.root.position.y += 0.3 * frameDt;
        }
      }

      // Transition: dispose meshes and spawn feathers
      if (elapsed >= SPIN_DURATION && !meshesDisposed) {
        meshesDisposed = true;
        this._disposeSlotMeshes(slot);

        // Spawn feather debris
        const featherColors = ['#F5F0E0', '#E0D8C4', '#3D3D3D', '#4A3A2A'];
        featherParents = [];
        featherDebris = [];
        const featherSize = VOXEL_SIZE * 0.7;

        for (const hex of featherColors) {
          const parent = MeshBuilder.CreateBox(`vortexP_${hex}`, { size: featherSize }, this.scene);
          const mat = new StandardMaterial(`vortexM_${hex}`, this.scene);
          mat.disableLighting = true;
          mat.emissiveColor = hexToColor3(hex);
          parent.material = mat;
          parent.isVisible = false;
          featherParents.push(parent);

          const count = 1 + Math.floor(Math.random() * 2); // 1-2 per color = 4-8 total
          for (let i = 0; i < count; i++) {
            const inst = parent.createInstance('f');
            inst.position.set(
              centerX + (Math.random() - 0.5) * 0.3,
              centerY + Math.random() * 0.3,
              (Math.random() - 0.5) * 0.2
            );
            featherDebris.push({
              mesh: inst,
              vx: (Math.random() - 0.5) * 2,
              vy: Math.random() * 1.5 + 0.5,
              life: 1.2 + Math.random() * 0.5,
            });
          }
        }
      }

      // Phase 2: Animate feather debris
      if (featherDebris) {
        let remaining = 0;
        for (const d of featherDebris) {
          if (d.life <= 0) {
            continue;
          }
          remaining++;

          d.vx *= 0.97;
          d.vy -= GRAVITY * 0.3 * frameDt;
          d.mesh.position.x += d.vx * frameDt;
          d.mesh.position.y += d.vy * frameDt;
          d.mesh.rotation.x += 4 * frameDt;
          d.mesh.rotation.z += 3 * frameDt;
          d.life -= frameDt;

          if (d.life < 0.4) {
            const s = Math.max(0, d.life / 0.4);
            d.mesh.scaling.setAll(s);
          }

          if (d.life <= 0) {
            d.mesh.dispose();
          }
        }

        // All feathers expired — clean up
        if (remaining === 0) {
          this.scene.onBeforeRenderObservable.remove(observer);
          for (const p of featherParents) {
            p.dispose();
          }
          slot.vortexing = false;
          slot.vortexObserver = null;
        }
      }
    });

    slot.vortexObserver = observer;
  }

  // ---- Death / Explosion ----

  /**
   * Collect world-space voxel positions from a character's rigs, keeping every 3rd
   * voxel to reduce particle count (~1000 → ~333). Returns array of {wx, wy, wz, hex}.
   */
  _collectDebrisVoxels(char, charIdx) {
    const birdModelDef = char.wingMode === 'updown' ? ostrichModel : buzzardModel;
    let knightPalette;
    let knightModelDef;
    if (charIdx === 0) {
      knightModelDef = knightModel;
      knightPalette = buildKnightPalette(char.paletteIndex);
    } else {
      knightModelDef = evilKnightModel;
      const paletteIdx = char.enemyType !== undefined ? char.enemyType : ENEMY_TYPE_BOUNDER;
      knightPalette = buildEvilKnightPalette(paletteIdx);
    }

    const rigSources = [
      { rig: char.birdRig, modelDef: birdModelDef, palette: birdModelDef.palette },
      { rig: char.knightRig, modelDef: knightModelDef, palette: knightPalette },
      { rig: char.lanceRig, modelDef: lanceModel, palette: lanceModel.palette },
    ];

    const voxels = [];
    let counter = 0;

    for (const { rig, modelDef, palette } of rigSources) {
      if (!rig) {
        continue;
      }

      for (const [partName, partData] of Object.entries(modelDef.parts)) {
        if (!rig.parts[partName] || !rig.parts[partName].mesh) {
          continue;
        }

        const { layers } = partData;
        if (!layers || layers.length === 0) {
          continue;
        }

        const worldPos = rig.parts[partName].mesh.getAbsolutePosition();
        const height = layers.length;
        const depth = layers[0].length;
        const width = layers[0][0].length;
        const centerX = (width - 1) / 2;
        const centerZ = (depth - 1) / 2;

        for (let y = 0; y < height; y++) {
          for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
              const colorIndex = layers[y][z][x];
              if (colorIndex === 0) {
                continue;
              }

              const hex = palette[colorIndex];
              if (!hex) {
                continue;
              }

              // Keep every 3rd voxel for 1/3 reduction
              counter++;
              if (counter % 3 !== 0) {
                continue;
              }

              voxels.push({
                wx: worldPos.x + (x - centerX) * VOXEL_SIZE,
                wy: worldPos.y + y * VOXEL_SIZE,
                wz: worldPos.z + (z - centerZ) * VOXEL_SIZE,
                hex,
              });
            }
          }
        }
      }
    }

    return voxels;
  }

  _explodeCharacter(char, charIdx) {
    const voxels = this._collectDebrisVoxels(char, charIdx);
    if (voxels.length === 0) {
      return;
    }

    // Build SPS with one particle per kept voxel
    const sps = new SolidParticleSystem('explodeSPS', this.scene, { updatable: true });
    const template = MeshBuilder.CreateBox('explodeTpl', { size: VOXEL_SIZE }, this.scene);
    sps.addShape(template, voxels.length);
    template.dispose();

    const spsMesh = sps.buildMesh();
    const mat = new StandardMaterial('explodeMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    spsMesh.material = mat;
    spsMesh.hasVertexAlpha = false;

    // Per-particle physics data (parallel to sps.particles)
    const debrisData = [];

    sps.initParticles = () => {
      for (let i = 0; i < sps.nbParticles; i++) {
        const p = sps.particles[i];
        const v = voxels[i];
        p.position.set(v.wx, v.wy, v.wz);
        p.color = hexToColor4(v.hex);
        debrisData.push({
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 2,
          life: 1.2 + Math.random() * 0.5,
        });
      }
    };

    sps.initParticles();
    sps.setParticles();

    // Track for dispose-time cleanup
    const entry = { sps, mat, observer: null };
    this._activeDebrisSystems.push(entry);

    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const frameDt = this.engine.getDeltaTime() / 1000;
      let remaining = 0;

      sps.updateParticle = (p) => {
        const d = debrisData[p.idx];
        if (d.life <= 0) {
          p.scaling.setAll(0);
          return p;
        }
        remaining++;

        d.vx *= 0.97;
        d.vy -= GRAVITY * frameDt;
        p.position.x += d.vx * frameDt;
        p.position.y += d.vy * frameDt;
        p.rotation.x += 5 * frameDt;
        p.rotation.z += 3 * frameDt;
        d.life -= frameDt;

        if (d.life < 0.4) {
          const s = Math.max(0, d.life / 0.4);
          p.scaling.set(s, s, s);
        }

        if (d.life <= 0) {
          p.scaling.setAll(0);
        }
        return p;
      };

      sps.setParticles();

      if (remaining === 0) {
        this.scene.onBeforeRenderObservable.remove(observer);
        sps.dispose();
        mat.dispose();
        const idx = this._activeDebrisSystems.indexOf(entry);
        if (idx !== -1) {
          this._activeDebrisSystems.splice(idx, 1);
        }
      }
    });

    entry.observer = observer;
  }

  // ---- Lava Death Effects ----

  _burnCharacter(char, charIdx, lavaY) {
    const FIRE_COLORS = ['#FFD040', '#FF6010', '#C02800'];
    const FIRE_COLOR4S = FIRE_COLORS.map(hexToColor4);

    const voxels = this._collectDebrisVoxels(char, charIdx);
    if (voxels.length === 0) {
      return;
    }

    // Build SPS with one particle per kept voxel
    const sps = new SolidParticleSystem('burnSPS', this.scene, { updatable: true });
    const template = MeshBuilder.CreateBox('burnTpl', { size: VOXEL_SIZE }, this.scene);
    sps.addShape(template, voxels.length);
    template.dispose();

    const spsMesh = sps.buildMesh();
    const mat = new StandardMaterial('burnMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    spsMesh.material = mat;
    spsMesh.hasVertexAlpha = false;

    // Per-particle physics data
    const debrisData = [];

    sps.initParticles = () => {
      for (let i = 0; i < sps.nbParticles; i++) {
        const p = sps.particles[i];
        const v = voxels[i];
        p.position.set(v.wx, v.wy, v.wz);
        p.color = FIRE_COLOR4S[Math.floor(Math.random() * FIRE_COLOR4S.length)];
        const isSpark = Math.random() < 0.1;
        debrisData.push({
          vx: (Math.random() - 0.5) * 1.0,
          vy: isSpark ? (0.5 + Math.random() * 1.5) : -(0.5 + Math.random() * 1.5),
          life: 0.4 + Math.random() * 0.4,
        });
      }
    };

    sps.initParticles();
    sps.setParticles();

    // Track for dispose-time cleanup
    const entry = { sps, mat, observer: null };
    this._activeDebrisSystems.push(entry);

    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const frameDt = this.engine.getDeltaTime() / 1000;
      let remaining = 0;

      sps.updateParticle = (p) => {
        const d = debrisData[p.idx];
        if (d.life <= 0) {
          p.scaling.setAll(0);
          return p;
        }
        remaining++;

        d.vy -= GRAVITY * 2.0 * frameDt;
        p.position.x += d.vx * frameDt;
        p.position.y += d.vy * frameDt;
        d.life -= frameDt;

        // Fast-fade below lava surface
        const belowLava = lavaY - p.position.y;
        if (belowLava > 0) {
          d.life -= frameDt * 4;
        }

        if (d.life < 0.2) {
          const s = Math.max(0, d.life / 0.2);
          p.scaling.set(s, s, s);
        }

        if (d.life <= 0) {
          p.scaling.setAll(0);
        }
        return p;
      };

      sps.setParticles();

      if (remaining === 0) {
        this.scene.onBeforeRenderObservable.remove(observer);
        sps.dispose();
        mat.dispose();
        const idx = this._activeDebrisSystems.indexOf(entry);
        if (idx !== -1) {
          this._activeDebrisSystems.splice(idx, 1);
        }
      }
    });

    entry.observer = observer;
  }

  _spawnLavaDeathSplash(x) {
    const tex = new DynamicTexture('lavaDeathSplashTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 220, 80, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 120, 30, 0.9)');
    gradient.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const lavaY = this._orthoBottom + 1.2;
    const ps = new ParticleSystem('lavaDeathSplash', 60, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(x, lavaY, 0.4);

    ps.direction1 = new Vector3(-1.5, 2, 0);
    ps.direction2 = new Vector3(1.5, 6, 0);
    ps.gravity = new Vector3(0, -8, 0);

    ps.minSize = 0.12;
    ps.maxSize = 0.35;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 1.0;

    ps.emitRate = 60;
    ps.manualEmitCount = 35;

    ps.color1 = new Color4(1.0, 0.85, 0.3, 1);
    ps.color2 = new Color4(1.0, 0.45, 0.1, 1);
    ps.colorDead = new Color4(0.6, 0.1, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 0.2;
    ps.disposeOnStop = true;
    ps.start();
  }

  _spawnFireColumn(x, lavaY) {
    const tex = new DynamicTexture('fireColTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 200, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 180, 50, 0.8)');
    gradient.addColorStop(0.7, 'rgba(255, 80, 10, 0.4)');
    gradient.addColorStop(1, 'rgba(100, 20, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('fireColumn', 100, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(x, lavaY, 0.3);

    ps.minEmitBox = new Vector3(-0.3, 0, 0);
    ps.maxEmitBox = new Vector3(0.3, 0, 0);

    ps.direction1 = new Vector3(-0.3, 1.5, 0);
    ps.direction2 = new Vector3(0.3, 4.0, 0);
    ps.gravity = new Vector3(0, -1, 0);

    ps.minSize = 0.15;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;

    ps.emitRate = 60;

    ps.color1 = new Color4(1.0, 0.9, 0.3, 1);
    ps.color2 = new Color4(1.0, 0.5, 0.1, 0.9);
    ps.colorDead = new Color4(0.3, 0.05, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 1.5;
    ps.disposeOnStop = true;
    ps.start();
  }


}
