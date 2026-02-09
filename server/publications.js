import { Meteor } from 'meteor/meteor';
import { ChatMessages } from '../imports/api/collections.js';

// Publish chat messages from MongoDB
// Meteor's oplog tailing handles real-time updates automatically
Meteor.publish('chatMessages', function() {
  if (!this.userId) {
    return this.ready();
  }

  return ChatMessages.find({}, { sort: { createdAt: -1 }, limit: 100 });
});

// Publish current user's subscription data
Meteor.publish('userData', function() {
  if (!this.userId) {
    return this.ready();
  }
  
  return Meteor.users.find(
    { _id: this.userId },
    { 
      fields: { 
        username: 1,
        emails: 1,
        subscriptions: 1,
        'services.sso.hubUserId': 1
      } 
    }
  );
});
