import { Mongo } from 'meteor/mongo';

export const ChatMessages = new Mongo.Collection('chatMessages');
export const UsedNonces = new Mongo.Collection('usedNonces');
export const SubscriptionCache = new Mongo.Collection('subscriptionCache');
