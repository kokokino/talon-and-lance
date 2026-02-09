import { Meteor } from 'meteor/meteor';
import { UsedNonces, SubscriptionCache } from '../imports/api/collections.js';

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
});
