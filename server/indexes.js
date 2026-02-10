import { Meteor } from 'meteor/meteor';
import { UsedNonces, SubscriptionCache } from '../imports/api/collections.js';
import { GameRooms } from '../imports/lib/collections/gameRooms.js';

Meteor.startup(async () => {
  // SSO user lookup index
  await Meteor.users.createIndexAsync({ 'services.sso.hubUserId': 1 });

  // TTL index: auto-delete nonces after 10 minutes
  await UsedNonces.createIndexAsync(
    { createdAt: 1 },
    { expireAfterSeconds: 600 }
  );

  // TTL index: auto-delete cache entries after 5 minutes
  await SubscriptionCache.createIndexAsync(
    { createdAt: 1 },
    { expireAfterSeconds: 300 }
  );

  // GameRooms indexes
  await GameRooms.createIndexAsync({ status: 1, createdAt: -1 });
  await GameRooms.createIndexAsync({ 'players.userId': 1 });
  await GameRooms.createIndexAsync({ hostId: 1 });
});
