import m from 'mithril';
import { Meteor } from 'meteor/meteor';

export const SessionExpired = {
  view() {
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    
    return m('div.auth-page', [
      m('h1', '⏰ Session Expired'),
      m('p', 'Your session has expired. Please log in again through the Hub.'),
      m('a.button', { href: hubUrl }, 'Return to Hub')
    ]);
  }
};
