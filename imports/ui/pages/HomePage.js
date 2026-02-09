import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { ChatRoom } from '../components/ChatRoom.js';
import { RequireAuth } from '../components/RequireAuth.js';

const HomeContent = {
  view() {
    return m('div', [
      m('h1', 'Welcome to Spoke App Skeleton'),
      m('p', 'This is a demo spoke app that integrates with the Kokokino Hub for authentication.'),
      
      m('article', [
        m('header', m('h2', 'Demo Chat Room')),
        m('p', 'This chat demonstrates real-time Meteor publications. Messages are stored in-memory and will be lost when the server restarts.'),
        m(ChatRoom)
      ])
    ]);
  }
};

export const HomePage = {
  view() {
    return m(RequireAuth, m(HomeContent));
  }
};
