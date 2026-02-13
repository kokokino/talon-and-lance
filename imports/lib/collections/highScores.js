import { Mongo } from 'meteor/mongo';

export const HighScores = new Mongo.Collection('highScores');
// Schema: { userId, username, score, gameMode, waveReached, createdAt }
