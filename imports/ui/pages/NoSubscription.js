import m from 'mithril';
import { Meteor } from 'meteor/meteor';

export const NoSubscription = {
  view() {
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    const requiredProducts = Meteor.settings.public?.requiredProducts || [];
    
    return m('div.auth-page', [
      m('h1', '📋 Subscription Required'),
      m('p', 'You need an active subscription to access this app.'),
      
      requiredProducts.length > 0 && m('p', [
        'Required: ',
        requiredProducts.join(', ')
      ]),
      
      m('a.button', { href: hubUrl }, 'Manage Subscription in Hub')
    ]);
  }
};
