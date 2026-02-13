import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { GameRooms, RoomStatus, GameMode, MAX_PLAYERS } from '../../imports/lib/collections/gameRooms.js';

Meteor.methods({
  /**
   * Find an existing room to join, or create a new one.
   * Arcade drop-in model: game starts immediately, others join mid-game.
   *
   * @param {string} gameMode - 'team' or 'pvp'
   * @param {number} paletteIndex - player's chosen color palette (0-3)
   * @returns {{ roomId: string, playerSlot: number }}
   */
  async 'matchmaking.findOrCreate'(gameMode, paletteIndex) {
    check(gameMode, Match.Where((val) => val === GameMode.TEAM_PLAY || val === GameMode.PVP));
    check(paletteIndex, Match.Integer);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to play');
    }

    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }

    // Check if already in an active room
    const existingRoom = await GameRooms.findOneAsync({
      'players.userId': this.userId,
      status: { $in: [RoomStatus.WAITING, RoomStatus.STARTING, RoomStatus.PLAYING] },
    });

    if (existingRoom) {
      // Return existing room info
      const player = existingRoom.players.find(p => p.userId === this.userId);
      return { roomId: existingRoom._id, playerSlot: player.slot };
    }

    // Find a joinable room with same game mode
    const openRoom = await GameRooms.findOneAsync({
      gameMode,
      status: { $in: [RoomStatus.WAITING, RoomStatus.PLAYING] },
      $expr: { $lt: [{ $size: '$players' }, MAX_PLAYERS] },
    }, {
      sort: { createdAt: -1 }, // prefer newest rooms
    });

    if (openRoom) {
      // Join existing room
      const usedSlots = openRoom.players.map(p => p.slot);
      let nextSlot = 0;
      while (usedSlots.includes(nextSlot)) {
        nextSlot++;
      }

      await GameRooms.updateAsync(openRoom._id, {
        $push: {
          players: {
            userId: this.userId,
            username: user.username || 'Anonymous',
            peerJsId: null,
            ready: false,
            slot: nextSlot,
            paletteIndex: paletteIndex,
          },
        },
        $set: { status: RoomStatus.PLAYING },
      });

      return { roomId: openRoom._id, playerSlot: nextSlot };
    }

    // No open rooms — create new one
    const roomId = await GameRooms.insertAsync({
      hostId: this.userId,
      gameMode,
      players: [{
        userId: this.userId,
        username: user.username || 'Anonymous',
        peerJsId: null,
        ready: false,
        slot: 0,
        paletteIndex: paletteIndex,
      }],
      status: RoomStatus.PLAYING, // starts immediately (arcade drop-in)
      maxPlayers: MAX_PLAYERS,
      settings: {},
      gameSeed: (Date.now() ^ Math.floor(Math.random() * 0x7FFFFFFF)) >>> 0,
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
    });

    return { roomId, playerSlot: 0 };
  },
});
