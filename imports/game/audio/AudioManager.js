// AudioManager — owns Babylon Audio V2 engine and current music track.
// Survives scene transitions since audio is not tied to a Babylon Scene.

import { CreateAudioEngineAsync, CreateStreamingSoundAsync } from '@babylonjs/core/AudioV2';

const MENU_TRACKS = [
  { name: 'Track 1', url: '/audio/menu-theme-1.mp3' },
  { name: 'Track 2', url: '/audio/menu-theme-2.mp3' },
  { name: 'Track 3', url: '/audio/menu-theme-3.mp3' },
];

export class AudioManager {
  constructor() {
    this._audioEngine = null;
    this._currentSound = null;
    const storedTrack = parseInt(localStorage.getItem('talon-lance:trackIndex'), 10);
    this._trackIndex = Number.isNaN(storedTrack) ? 1 : storedTrack;
  }

  /**
   * Initialize the Babylon Audio V2 engine.
   */
  async init() {
    this._audioEngine = await CreateAudioEngineAsync();
    this._audioEngine.volume = 0.5;
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
    this._currentSound = await CreateStreamingSoundAsync(
      'menuMusic',
      MENU_TRACKS[index].url,
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
   * Stop music and dispose audio engine.
   */
  dispose() {
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
