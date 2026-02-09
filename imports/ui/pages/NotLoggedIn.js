import m from 'mithril';
import { Meteor } from 'meteor/meteor';

export const NotLoggedIn = {
  view() {
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    
    return m('div.auth-page', [
      m('h1', '🔐 Not Logged In'),
      m('p', 'You need to log in through the Kokokino Hub to access this app.'),
      m('a.button', { href: hubUrl }, 'Go to Hub to Login')
    ]);
  }
};
