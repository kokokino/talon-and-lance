import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { validateSsoToken } from '../imports/hub/ssoHandler.js';

// Register custom login handler for SSO
Accounts.registerLoginHandler('sso', async function(options) {
  // Only handle SSO login requests
  if (!options.ssoToken) {
    return undefined;
  }
  
  const { ssoToken } = options;
  
  // Validate the SSO token
  const validation = await validateSsoToken(ssoToken);
  
  if (!validation.valid) {
    throw new Meteor.Error('sso-failed', validation.error || 'SSO validation failed');
  }
  
  const { userId, username, email, subscriptions } = validation;
  
  // Find or create the user
  let user = await Meteor.users.findOneAsync({ 'services.sso.hubUserId': userId });
  
  if (!user) {
    // Create new user directly in the users collection
    const newUserId = await Meteor.users.insertAsync({
      username: username,
      emails: email ? [{ address: email, verified: true }] : [],
      services: {
        sso: {
          hubUserId: userId,
          lastLogin: new Date()
        }
      },
      subscriptions: subscriptions,
      createdAt: new Date()
    });
    
    user = await Meteor.users.findOneAsync(newUserId);
  } else {
    // Update existing user
    await Meteor.users.updateAsync(user._id, {
      $set: {
        username: username,
        'emails.0.address': email,
        'services.sso.lastLogin': new Date(),
        subscriptions: subscriptions
      }
    });
  }
  
  return {
    userId: user._id
  };
});

// Configure accounts
Accounts.config({
  forbidClientAccountCreation: true
});
