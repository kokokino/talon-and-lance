import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { HighScores } from '../../imports/lib/collections/highScores.js';

// Publish top 10 high scores, optionally filtered by game mode
Meteor.publish('highScores.top10', function (gameMode) {
  check(gameMode, Match.Optional(String));

  const query = {};
  if (gameMode) {
    query.gameMode = gameMode;
  }

  return HighScores.find(query, {
    sort: { score: -1 },
    limit: 10,
    fields: {
      username: 1,
      score: 1,
      gameMode: 1,
      waveReached: 1,
      createdAt: 1,
    },
  });
});
