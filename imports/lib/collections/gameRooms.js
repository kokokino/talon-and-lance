import { Mongo } from 'meteor/mongo';

export const GameRooms = new Mongo.Collection('gameRooms');

// Room status constants
export const RoomStatus = {
  WAITING: 'waiting',
  STARTING: 'starting',
  PLAYING: 'playing',
  FINISHED: 'finished',
};

// Maximum players per room
export const MAX_PLAYERS = 4;

// Default game settings
export const DEFAULT_SETTINGS = {
  npcBuzzards: 5,
  lives: 3,
  map: 'classic',
};
