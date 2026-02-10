import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { GameRooms, RoomStatus } from '../../imports/lib/collections/gameRooms.js';

// Publish all rooms with status 'waiting' (for lobby browser)
Meteor.publish('rooms.lobby', function () {
  if (!this.userId) {
    return this.ready();
  }

  return GameRooms.find(
    { status: RoomStatus.WAITING },
    {
      fields: {
        hostId: 1,
        players: 1,
        status: 1,
        maxPlayers: 1,
        settings: 1,
        createdAt: 1,
      },
      sort: { createdAt: -1 },
      limit: 50,
    }
  );
});

// Publish reactive room data for a specific room (joined players)
// Includes PeerJS IDs, ready states, status changes
Meteor.publish('rooms.current', function (roomId) {
  check(roomId, String);

  if (!this.userId) {
    return this.ready();
  }

  return GameRooms.find(
    {
      _id: roomId,
      'players.userId': this.userId,
    },
    {
      fields: {
        hostId: 1,
        players: 1,
        status: 1,
        maxPlayers: 1,
        settings: 1,
        createdAt: 1,
        startedAt: 1,
        finishedAt: 1,
        results: 1,
      },
    }
  );
});
