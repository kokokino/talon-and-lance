// AudioManager — owns Babylon Audio V2 engine, music tracks, and SFX pools.
// Survives scene transitions since audio is not tied to a Babylon Scene.

import { CreateAudioEngineAsync, CreateStreamingSoundAsync, CreateSoundAsync } from '@babylonjs/core/AudioV2';

const MENU_TRACKS = [
  { name: 'Track 1', url: '/audio/menu-theme-1.mp3' },
  { name: 'Track 2', url: '/audio/menu-theme-2.mp3' },
  { name: 'Track 3', url: '/audio/menu-theme-3.mp3' },
  { name: 'None', url: null },
];

// UI sounds — loaded immediately during init()
const UI_SFX = [
  { name: 'ui-select', url: '/audio/sfx/ui/ui-select.mp3', pool: 1, volume: 0.6 },
  { name: 'ui-hover', url: '/audio/sfx/ui/ui-hover.mp3', pool: 1, volume: 0.4 },
  { name: 'ui-cancel', url: '/audio/sfx/ui/ui-cancel.mp3', pool: 1, volume: 0.6 },
];

// Game sounds — loaded on demand via loadGameSfx()
const GAME_SFX = [
  // Movement
  { name: 'flap-1', url: '/audio/sfx/movement/flap-1.mp3', pool: 2, volume: 0.5 },
  { name: 'flap-2', url: '/audio/sfx/movement/flap-2.mp3', pool: 2, volume: 0.5 },
  { name: 'flap-3', url: '/audio/sfx/movement/flap-3.mp3', pool: 2, volume: 0.5 },
  { name: 'flap-4', url: '/audio/sfx/movement/flap-4.mp3', pool: 2, volume: 0.5 },
  { name: 'flap-5', url: '/audio/sfx/movement/flap-5.mp3', pool: 2, volume: 0.5 },
  { name: 'land-1', url: '/audio/sfx/movement/land-1.mp3', pool: 2, volume: 0.5 },
  { name: 'land-2', url: '/audio/sfx/movement/land-2.mp3', pool: 2, volume: 0.5 },
  { name: 'land-3', url: '/audio/sfx/movement/land-3.mp3', pool: 2, volume: 0.5 },
  { name: 'skid', url: '/audio/sfx/movement/skid.mp3', pool: 1, volume: 0.4 },
  { name: 'stride-1', url: '/audio/sfx/movement/stride-1.mp3', pool: 2, volume: 0.3 },
  { name: 'stride-2', url: '/audio/sfx/movement/stride-2.mp3', pool: 2, volume: 0.3 },
  { name: 'stride-3', url: '/audio/sfx/movement/stride-3.mp3', pool: 2, volume: 0.3 },
  { name: 'edge-bump', url: '/audio/sfx/movement/edge-bump.mp3', pool: 1, volume: 0.4 },

  // Combat
  { name: 'death-explode', url: '/audio/sfx/combat/death-explode.mp3', pool: 2, volume: 0.7 },
  { name: 'joust-kill', url: '/audio/sfx/combat/joust-kill.mp3', pool: 2, volume: 0.6 },
  { name: 'joust-bounce-1', url: '/audio/sfx/combat/joust-bounce-1.mp3', pool: 2, volume: 0.6 },
  { name: 'joust-bounce-2', url: '/audio/sfx/combat/joust-bounce-2.mp3', pool: 2, volume: 0.6 },
  { name: 'invincible-end', url: '/audio/sfx/combat/invincible-end.mp3', pool: 1, volume: 0.5 },

  // Eggs
  { name: 'egg-drop', url: '/audio/sfx/eggs/egg-drop.mp3', pool: 2, volume: 0.5 },
  { name: 'egg-bounce-1', url: '/audio/sfx/eggs/egg-bounce-1.mp3', pool: 2, volume: 0.4 },
  { name: 'egg-bounce-2', url: '/audio/sfx/eggs/egg-bounce-2.mp3', pool: 2, volume: 0.4 },
  { name: 'egg-collect', url: '/audio/sfx/eggs/egg-collect.mp3', pool: 1, volume: 0.6 },
  { name: 'egg-lava', url: '/audio/sfx/eggs/egg-lava.mp3', pool: 1, volume: 0.5 },
  { name: 'egg-hatch', url: '/audio/sfx/eggs/egg-hatch.mp3', pool: 1, volume: 0.5 },
  { name: 'egg-wobble', url: '/audio/sfx/eggs/egg-wobble.mp3', pool: 1, volume: 0.4 },

  // Environment
  { name: 'lava-burst-1', url: '/audio/sfx/environment/lava-burst-1.mp3', pool: 2, volume: 0.3 },
  { name: 'lava-burst-2', url: '/audio/sfx/environment/lava-burst-2.mp3', pool: 2, volume: 0.3 },
  { name: 'lava-death', url: '/audio/sfx/environment/lava-death.mp3', pool: 1, volume: 0.7 },
  { name: 'vortex-suck', url: '/audio/sfx/environment/vortex-suck.mp3', pool: 1, volume: 0.6 },

  // Bonus
  { name: 'egg-catch-air', url: '/audio/sfx/bonus/egg-catch-air.mp3', pool: 1, volume: 0.6 },
  { name: 'enemy-materialize', url: '/audio/sfx/bonus/enemy-materialize.mp3', pool: 2, volume: 0.5 },
  { name: 'crowd-cheer', url: '/audio/sfx/bonus/crowd-cheer.mp3', pool: 1, volume: 0.5 },
  { name: 'score-tick', url: '/audio/sfx/bonus/score-tick.mp3', pool: 2, volume: 0.3 },
  { name: 'squawk-1', url: '/audio/sfx/bonus/squawk-1.mp3', pool: 1, volume: 0.4 },
  { name: 'squawk-2', url: '/audio/sfx/bonus/squawk-2.mp3', pool: 1, volume: 0.4 },

  // Pterodactyl
  { name: 'ptero-screech-1', url: '/audio/sfx/combat/ptero-screech-1.mp3', pool: 1, volume: 0.7 },
  { name: 'ptero-screech-2', url: '/audio/sfx/combat/ptero-screech-2.mp3', pool: 1, volume: 0.7 },
  { name: 'ptero-flap-1', url: '/audio/sfx/movement/ptero-flap-1.mp3', pool: 2, volume: 0.5 },
  { name: 'ptero-flap-2', url: '/audio/sfx/movement/ptero-flap-2.mp3', pool: 2, volume: 0.5 },
  { name: 'ptero-flap-3', url: '/audio/sfx/movement/ptero-flap-3.mp3', pool: 2, volume: 0.5 },
  { name: 'ptero-death', url: '/audio/sfx/combat/ptero-death.mp3', pool: 1, volume: 0.7 },
  { name: 'ptero-snap-1', url: '/audio/sfx/combat/ptero-snap-1.mp3', pool: 1, volume: 0.5 },
  { name: 'ptero-snap-2', url: '/audio/sfx/combat/ptero-snap-2.mp3', pool: 1, volume: 0.5 },
  { name: 'ptero-warning', url: '/audio/sfx/combat/ptero-warning.mp3', pool: 1, volume: 0.6 },
  { name: 'ptero-swoop', url: '/audio/sfx/combat/ptero-swoop.mp3', pool: 1, volume: 0.5 },

  // Progression
  { name: 'materialize', url: '/audio/sfx/progression/materialize.mp3', pool: 2, volume: 0.5 },
  { name: 'materialize-done', url: '/audio/sfx/progression/materialize-done.mp3', pool: 1, volume: 0.5 },
  { name: 'wave-start', url: '/audio/sfx/progression/wave-start.mp3', pool: 1, volume: 0.6 },
  { name: 'wave-complete', url: '/audio/sfx/progression/wave-complete.mp3', pool: 1, volume: 0.6 },
  { name: 'survival-bonus', url: '/audio/sfx/progression/survival-bonus.mp3', pool: 1, volume: 0.6 },
  { name: 'extra-life', url: '/audio/sfx/progression/extra-life.mp3', pool: 1, volume: 0.7 },
  { name: 'game-over', url: '/audio/sfx/progression/game-over.mp3', pool: 1, volume: 0.7 },
];

export class AudioManager {
  constructor() {
    this._audioEngine = null;
    this._currentSound = null;
    const storedTrack = parseInt(localStorage.getItem('talon-lance:trackIndex'), 10);
    this._trackIndex = Number.isNaN(storedTrack) ? 1 : storedTrack;

    // SFX pools: Map<string, Sound[]>
    this._sfxPools = new Map();
    // Round-robin index per pool: Map<string, number>
    this._sfxRobin = new Map();
    this._gameSfxLoaded = false;
    this._lavaAmbientSound = null;
  }

  /**
   * Initialize the Babylon Audio V2 engine and load UI SFX.
   */
  async init() {
    if (!this._audioEngine) {
      this._audioEngine = await CreateAudioEngineAsync();
      this._audioEngine.volume = 0.5;
    }
    await this._loadSfxGroup(UI_SFX);
    await this._playTrack(this._trackIndex);
  }

  /**
   * Play a specific track by index.
   * @param {number} index
   */
  async _playTrack(index) {
    if (this._currentSound) {
      this._currentSound.stop();
      this._currentSound.dispose();
      this._currentSound = null;
    }
    const track = MENU_TRACKS[index];
    if (!track.url) {
      return;
    }
    this._currentSound = await CreateStreamingSoundAsync(
      'menuMusic',
      track.url,
      { loop: true, autoplay: true }
    );
  }

  /**
   * Cycle to the next/previous track.
   * @param {number} direction — +1 or -1
   */
  async cycleTrack(direction) {
    this._trackIndex = ((this._trackIndex + direction) % MENU_TRACKS.length + MENU_TRACKS.length) % MENU_TRACKS.length;
    localStorage.setItem('talon-lance:trackIndex', this._trackIndex);
    await this._playTrack(this._trackIndex);
  }

  /**
   * @returns {number} Current track index
   */
  getTrackIndex() {
    return this._trackIndex;
  }

  /**
   * @returns {string} Current track display name
   */
  getTrackName() {
    return MENU_TRACKS[this._trackIndex].name;
  }

  /**
   * Load all game SFX (call once when entering gameplay).
   */
  async loadGameSfx() {
    if (this._gameSfxLoaded) {
      return;
    }
    await this._loadSfxGroup(GAME_SFX);

    // Lava ambient loop — separate from pooled SFX
    try {
      this._lavaAmbientSound = await CreateSoundAsync(
        'lava-ambient',
        '/audio/sfx/environment/lava-ambient.mp3',
        { loop: true, autoplay: false, volume: 0.15 }
      );
    } catch (e) {
      console.warn('[AudioManager] Failed to load lava-ambient:', e);
    }

    this._gameSfxLoaded = true;
  }

  /**
   * Load a group of SFX entries into pools.
   */
  async _loadSfxGroup(sfxList) {
    const promises = [];
    for (const entry of sfxList) {
      for (let i = 0; i < entry.pool; i++) {
        const promise = CreateSoundAsync(
          entry.name,
          entry.url,
          { loop: false, autoplay: false, volume: entry.volume }
        ).then(sound => {
          if (!this._sfxPools.has(entry.name)) {
            this._sfxPools.set(entry.name, []);
            this._sfxRobin.set(entry.name, 0);
          }
          this._sfxPools.get(entry.name).push(sound);
        }).catch(e => {
          console.warn(`[AudioManager] Failed to load ${entry.name}:`, e);
        });
        promises.push(promise);
      }
    }
    await Promise.all(promises);
  }

  /**
   * Play a sound effect by name, with optional variant selection.
   * @param {string} baseName — base name (e.g. 'flap')
   * @param {number} [variants] — if > 1, appends random suffix '-1' through '-N'
   */
  playSfx(baseName, variants) {
    let name = baseName;
    if (variants > 1) {
      name = `${baseName}-${1 + Math.floor(Math.random() * variants)}`;
    }
    const pool = this._sfxPools.get(name);
    if (!pool || pool.length === 0) {
      return;
    }
    const idx = this._sfxRobin.get(name) || 0;
    const sound = pool[idx % pool.length];
    this._sfxRobin.set(name, idx + 1);
    sound.play();
  }

  startLavaAmbient() {
    if (this._lavaAmbientSound) {
      this._lavaAmbientSound.play();
    }
  }

  stopLavaAmbient() {
    if (this._lavaAmbientSound) {
      this._lavaAmbientSound.stop();
    }
  }

  /**
   * Stop music, dispose all SFX and audio engine.
   */
  dispose() {
    if (this._lavaAmbientSound) {
      this._lavaAmbientSound.stop();
      this._lavaAmbientSound.dispose();
      this._lavaAmbientSound = null;
    }
    for (const pool of this._sfxPools.values()) {
      for (const sound of pool) {
        sound.dispose();
      }
    }
    this._sfxPools.clear();
    this._sfxRobin.clear();
    this._gameSfxLoaded = false;

    if (this._currentSound) {
      this._currentSound.stop();
      this._currentSound.dispose();
      this._currentSound = null;
    }
    if (this._audioEngine) {
      this._audioEngine.dispose();
      this._audioEngine = null;
    }
  }
}
