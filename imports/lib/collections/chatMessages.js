import { Mongo } from 'meteor/mongo';

// Client-side only collection for chat messages
// Messages are stored in-memory on the server and published to clients
export const ChatMessages = new Mongo.Collection('chatMessages');
