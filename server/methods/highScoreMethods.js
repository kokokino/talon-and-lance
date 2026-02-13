import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { HighScores } from '../../imports/lib/collections/highScores.js';
import { GameMode } from '../../imports/lib/collections/gameRooms.js';

const MAX_REASONABLE_SCORE = 10000000; // anti-cheat sanity check

Meteor.methods({
  /**
   * Submit a high score. Only saves if higher than existing for this user+mode.
   *
   * @param {number} score - the player's score
   * @param {string} gameMode - 'team' or 'pvp'
   * @param {number} waveReached - highest wave reached
   */
  async 'highScores.submit'(score, gameMode, waveReached) {
    check(score, Match.Integer);
    check(gameMode, Match.Where((val) => val === GameMode.TEAM_PLAY || val === GameMode.PVP));
    check(waveReached, Match.Integer);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to submit scores');
    }

    if (score < 0 || score > MAX_REASONABLE_SCORE) {
      throw new Meteor.Error('invalid-score', 'Score is out of valid range');
    }

    if (waveReached < 1 || waveReached > 1000) {
      throw new Meteor.Error('invalid-wave', 'Wave number is out of valid range');
    }

    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }

    const username = user.username || 'Anonymous';

    // Check existing score for this user + mode
    const existing = await HighScores.findOneAsync({
      userId: this.userId,
      gameMode,
    });

    if (existing) {
      // Only update if new score is higher
      if (score > existing.score) {
        await HighScores.updateAsync(existing._id, {
          $set: {
            score,
            username,
            waveReached,
            createdAt: new Date(),
          },
        });
      }
    } else {
      await HighScores.insertAsync({
        userId: this.userId,
        username,
        score,
        gameMode,
        waveReached,
        createdAt: new Date(),
      });
    }
  },
});
