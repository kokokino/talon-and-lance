import { Migrations } from 'meteor/quave:migrations';
import { UsedNonces } from '../../imports/api/collections.js';

Migrations.add({
  version: 1,
  name: 'Create UsedNonces TTL index',
  async up() {
    const rawCollection = UsedNonces.rawCollection();

    // Create TTL index to auto-expire nonces after 10 minutes
    // This keeps the collection small and prevents unbounded growth
    await rawCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 600 }  // 10 minutes
    );

    console.log('Created UsedNonces TTL index (10 minute expiry)');
  },
  async down() {
    const rawCollection = UsedNonces.rawCollection();
    await rawCollection.dropIndex('createdAt_1');
    console.log('Dropped UsedNonces TTL index');
  }
});
