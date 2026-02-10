import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

// Limit chat.send: 10 calls per 10 seconds per user
DDPRateLimiter.addRule({
  type: 'method',
  name: 'chat.send',
  userId: () => true
}, 10, 10000);

// Limit subscription methods: 5 calls per 10 seconds per connection
DDPRateLimiter.addRule({
  type: 'method',
  name: 'user.getSubscriptionStatus'
}, 5, 10000);

// Limit room creation: 5 calls per 10 seconds per user
DDPRateLimiter.addRule({
  type: 'method',
  name: 'rooms.create',
  userId: () => true
}, 5, 10000);

// Limit room joins: 10 calls per 10 seconds per user
DDPRateLimiter.addRule({
  type: 'method',
  name: 'rooms.join',
  userId: () => true
}, 10, 10000);

// Limit ready toggles: 10 calls per 10 seconds per user
DDPRateLimiter.addRule({
  type: 'method',
  name: 'rooms.setReady',
  userId: () => true
}, 10, 10000);
