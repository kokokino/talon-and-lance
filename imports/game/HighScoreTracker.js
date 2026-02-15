// HighScoreTracker — Periodically checks and submits high scores during gameplay.
// Fetches the player's current best on start, then every ~15 seconds checks if
// the current score exceeds it. If so, submits the new high score to the server.
// All Meteor calls are wrapped in try/catch so gameplay is never interrupted.

import { Meteor } from 'meteor/meteor';

const CHECK_INTERVAL_MS = 15000;

export class HighScoreTracker {
  /**
   * @param {{
   *   gameMode: string,
   *   getScore: () => number,
   *   getWave: () => number,
   * }} config
   */
  constructor({ gameMode, getScore, getWave }) {
    this._gameMode = gameMode;
    this._getScore = getScore;
    this._getWave = getWave;
    this._cachedBest = 0;
    this._intervalId = null;
  }

  /**
   * Fetch the player's current best score and start periodic checking.
   */
  async start() {
    try {
      this._cachedBest = await Meteor.callAsync('highScores.myBest', this._gameMode);
    } catch (err) {
      // Not logged in or server error — default to 0
      this._cachedBest = 0;
    }

    this._intervalId = setInterval(() => {
      this._checkAndSubmit();
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic checking and do one final check+submit.
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._checkAndSubmit();
  }

  async _checkAndSubmit() {
    try {
      const currentScore = this._getScore();
      const currentWave = this._getWave();

      if (currentScore > this._cachedBest) {
        await Meteor.callAsync('highScores.submit', currentScore, this._gameMode, currentWave);
        this._cachedBest = currentScore;
      }
    } catch (err) {
      // Silently ignore — user may not be logged in, or server may be unreachable
    }
  }
}
