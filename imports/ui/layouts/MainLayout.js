import m from 'mithril';
import { Meteor } from 'meteor/meteor';

export const MainLayout = {
  view(vnode) {
    const user = Meteor.user();
    const isLoggingIn = Meteor.loggingIn();
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    
    return m('div.main-layout', [
      // Header
      m('header.container', [
        m('a.brand[href=/]', { oncreate: m.route.link }, 
          Meteor.settings.public?.appName || 'Spoke App Skeleton'
        ),
        m('div.user-info', [
          isLoggingIn ? 
            m('span', 'Loading...') :
          user ? [
            m('span.username', user.username || 'User'),
            m('a', { href: hubUrl }, 'Hub'),
            m('button.outline.secondary', {
              onclick() {
                Meteor.logout(() => {
                  m.route.set('/not-logged-in');
                });
              }
            }, 'Logout')
          ] : [
            m('a', { href: hubUrl }, 'Login via Hub')
          ]
        ])
      ]),
      
      // Main content
      m('main.container', vnode.children),
      
      // Footer
      m('footer.container', [
        m('small', [
          'Powered by ',
          m('a', { href: hubUrl }, 'Kokokino'),
          ' • ',
          m('a', { href: hubUrl }, 'Return to Hub'), 
          ' • ',
          m('a', { href: 'https://github.com/kokokino/spoke_app_skeleton', target: '_blank', rel: 'noopener' }, 'GitHub')
        ])
      ])
    ]);
  }
};
