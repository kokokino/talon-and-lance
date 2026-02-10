import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { GameRooms, RoomStatus, MAX_PLAYERS, DEFAULT_SETTINGS } from '../../imports/lib/collections/gameRooms.js';

Meteor.methods({
  // Create a new game room
  async 'rooms.create'(settings) {
    check(settings, Match.Optional({
      npcBuzzards: Match.Optional(Match.Integer),
      lives: Match.Optional(Match.Integer),
      map: Match.Optional(String),
      maxPlayers: Match.Optional(Match.Integer),
    }));

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to create a room');
    }

    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }

    // Check user isn't already in a room
    const existingRoom = await GameRooms.findOneAsync({
      'players.userId': this.userId,
      status: { $in: [RoomStatus.WAITING, RoomStatus.STARTING, RoomStatus.PLAYING] },
    });

    if (existingRoom) {
      throw new Meteor.Error('already-in-room', 'You are already in a game room');
    }

    const gameSettings = {
      npcBuzzards: settings?.npcBuzzards ?? DEFAULT_SETTINGS.npcBuzzards,
      lives: settings?.lives ?? DEFAULT_SETTINGS.lives,
      map: settings?.map ?? DEFAULT_SETTINGS.map,
    };

    const maxPlayers = Math.min(Math.max(settings?.maxPlayers || 2, 2), MAX_PLAYERS);

    const roomId = await GameRooms.insertAsync({
      hostId: this.userId,
      players: [{
        userId: this.userId,
        username: user.username || 'Anonymous',
        peerJsId: null,
        ready: false,
        slot: 0,
      }],
      status: RoomStatus.WAITING,
      maxPlayers,
      settings: gameSettings,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    });

    return roomId;
  },

  // Join an existing room
  async 'rooms.join'(roomId) {
    check(roomId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to join a room');
    }

    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new Meteor.Error('room-not-joinable', 'This room is no longer accepting players');
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Meteor.Error('room-full', 'This room is full');
    }

    // Check if already in this room
    const alreadyInRoom = room.players.some(p => p.userId === this.userId);
    if (alreadyInRoom) {
      throw new Meteor.Error('already-in-room', 'You are already in this room');
    }

    // Check user isn't in another room
    const existingRoom = await GameRooms.findOneAsync({
      _id: { $ne: roomId },
      'players.userId': this.userId,
      status: { $in: [RoomStatus.WAITING, RoomStatus.STARTING, RoomStatus.PLAYING] },
    });

    if (existingRoom) {
      throw new Meteor.Error('already-in-room', 'You are already in another game room');
    }

    // Find next available slot
    const usedSlots = room.players.map(p => p.slot);
    let nextSlot = 0;
    while (usedSlots.includes(nextSlot)) {
      nextSlot++;
    }

    await GameRooms.updateAsync(roomId, {
      $push: {
        players: {
          userId: this.userId,
          username: user.username || 'Anonymous',
          peerJsId: null,
          ready: false,
          slot: nextSlot,
        },
      },
    });

    return roomId;
  },

  // Leave a room
  async 'rooms.leave'(roomId) {
    check(roomId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    const playerInRoom = room.players.some(p => p.userId === this.userId);
    if (!playerInRoom) {
      throw new Meteor.Error('not-in-room', 'You are not in this room');
    }

    // If the host leaves and room is waiting, close the room or migrate host
    if (room.hostId === this.userId) {
      const remainingPlayers = room.players.filter(p => p.userId !== this.userId);

      if (remainingPlayers.length === 0 || room.status === RoomStatus.WAITING) {
        if (remainingPlayers.length > 0) {
          // Migrate host to the next player
          await GameRooms.updateAsync(roomId, {
            $set: { hostId: remainingPlayers[0].userId },
            $pull: { players: { userId: this.userId } },
          });
        } else {
          // No players left, mark room as finished
          await GameRooms.updateAsync(roomId, {
            $set: { status: RoomStatus.FINISHED, finishedAt: new Date() },
          });
        }
      } else {
        // Game is in progress — just remove the player
        await GameRooms.updateAsync(roomId, {
          $pull: { players: { userId: this.userId } },
        });
      }
    } else {
      // Non-host leaves
      await GameRooms.updateAsync(roomId, {
        $pull: { players: { userId: this.userId } },
      });
    }
  },

  // Toggle ready state
  async 'rooms.setReady'(roomId, ready) {
    check(roomId, String);
    check(ready, Boolean);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new Meteor.Error('room-not-waiting', 'Room is not in waiting state');
    }

    const playerInRoom = room.players.some(p => p.userId === this.userId);
    if (!playerInRoom) {
      throw new Meteor.Error('not-in-room', 'You are not in this room');
    }

    await GameRooms.updateAsync(
      { _id: roomId, 'players.userId': this.userId },
      { $set: { 'players.$.ready': ready } }
    );
  },

  // Register PeerJS ID for WebRTC setup
  async 'rooms.setPeerJsId'(roomId, peerJsId) {
    check(roomId, String);
    check(peerJsId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    const playerInRoom = room.players.some(p => p.userId === this.userId);
    if (!playerInRoom) {
      throw new Meteor.Error('not-in-room', 'You are not in this room');
    }

    await GameRooms.updateAsync(
      { _id: roomId, 'players.userId': this.userId },
      { $set: { 'players.$.peerJsId': peerJsId } }
    );
  },

  // Host starts the game (all players must be ready)
  async 'rooms.start'(roomId) {
    check(roomId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    if (room.hostId !== this.userId) {
      throw new Meteor.Error('not-host', 'Only the host can start the game');
    }

    if (room.status !== RoomStatus.WAITING) {
      throw new Meteor.Error('room-not-waiting', 'Room is not in waiting state');
    }

    if (room.players.length < 2) {
      throw new Meteor.Error('not-enough-players', 'Need at least 2 players to start');
    }

    // Check all non-host players are ready
    const allReady = room.players.every(p => p.userId === room.hostId || p.ready);
    if (!allReady) {
      throw new Meteor.Error('players-not-ready', 'All players must be ready before starting');
    }

    // Check all players have PeerJS IDs
    const allHavePeerIds = room.players.every(p => p.peerJsId);
    if (!allHavePeerIds) {
      throw new Meteor.Error('peers-not-ready', 'Not all players have established peer connections');
    }

    await GameRooms.updateAsync(roomId, {
      $set: {
        status: RoomStatus.STARTING,
        startedAt: new Date(),
      },
    });
  },

  // Report game results when finished
  async 'rooms.reportResult'(roomId, results) {
    check(roomId, String);
    check(results, {
      winnerId: Match.Optional(String),
      scores: Match.Optional([{
        userId: String,
        score: Match.Integer,
        kills: Match.Integer,
        deaths: Match.Integer,
      }]),
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const room = await GameRooms.findOneAsync(roomId);
    if (!room) {
      throw new Meteor.Error('not-found', 'Room not found');
    }

    // Only host reports results (deterministic game = same result everywhere)
    if (room.hostId !== this.userId) {
      throw new Meteor.Error('not-host', 'Only the host reports game results');
    }

    if (room.status !== RoomStatus.STARTING && room.status !== RoomStatus.PLAYING) {
      throw new Meteor.Error('invalid-state', 'Game is not in progress');
    }

    await GameRooms.updateAsync(roomId, {
      $set: {
        status: RoomStatus.FINISHED,
        finishedAt: new Date(),
        results,
      },
    });
  },
});
