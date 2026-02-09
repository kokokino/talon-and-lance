import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { checkSubscription } from '../imports/hub/subscriptions.js';
import { ChatMessages } from '../imports/api/collections.js';

const MAX_MESSAGES = 100;

Meteor.methods({
  // Send a chat message
  async 'chat.send'(text) {
    check(text, String);
    
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to send messages');
    }
    
    // Validate text
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      throw new Meteor.Error('invalid-message', 'Message cannot be empty');
    }
    if (trimmedText.length > 500) {
      throw new Meteor.Error('invalid-message', 'Message too long (max 500 characters)');
    }
    
    // Get user info
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }
    
    // Check subscription (optional - can be enabled if chat requires subscription)
    const settings = Meteor.settings.public || {};
    const requiredProducts = settings.requiredProducts || [];
    
    if (requiredProducts.length > 0) {
      const hasAccess = await checkSubscription(this.userId, requiredProducts);
      if (!hasAccess) {
        throw new Meteor.Error('subscription-required', 'Active subscription required to send messages');
      }
    }
    
    const message = {
      text: trimmedText,
      userId: this.userId,
      username: user.username || 'Anonymous',
      createdAt: new Date()
    };

    const messageId = await ChatMessages.insertAsync(message);

    // Clean up old messages to keep collection capped at MAX_MESSAGES
    const count = await ChatMessages.countDocuments();
    if (count > MAX_MESSAGES) {
      const oldMessages = await ChatMessages.find(
        {},
        { sort: { createdAt: 1 }, limit: count - MAX_MESSAGES, fields: { _id: 1 } }
      ).fetchAsync();
      const idsToDelete = oldMessages.map(m => m._id);
      await ChatMessages.removeAsync({ _id: { $in: idsToDelete } });
    }

    return messageId;
  },
  
  // Get current user's subscription status
  async 'user.getSubscriptionStatus'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }
    
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) {
      throw new Meteor.Error('not-found', 'User not found');
    }
    
    return {
      subscriptions: user.subscriptions || [],
      hubUserId: user.services?.sso?.hubUserId
    };
  },
  
  // Check if user has required subscription
  async 'user.hasAccess'(requiredProductSlugs) {
    check(requiredProductSlugs, Match.Optional([String]));

    if (!this.userId) {
      return false;
    }

    const products = requiredProductSlugs || Meteor.settings.public?.requiredProducts || [];
    
    if (products.length === 0) {
      return true; // No subscription required
    }
    
    return await checkSubscription(this.userId, products);
  }
});
