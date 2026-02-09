import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';

export const SsoCallback = {
  oninit(vnode) {
    vnode.state.status = 'processing';
    vnode.state.error = null;
    
    // Get token from URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (!token) {
      vnode.state.status = 'error';
      vnode.state.error = 'No SSO token provided';
      m.redraw();
      return;
    }
    
    // Attempt SSO login
    Accounts.callLoginMethod({
      methodArguments: [{ ssoToken: token }],
      userCallback: (error) => {
        if (error) {
          console.error('SSO login failed:', error);
          vnode.state.status = 'error';
          
          // Map error codes to user-friendly messages
          if (error.error === 'sso-failed') {
            const reason = error.reason || '';
            if (reason.includes('expired')) {
              vnode.state.error = 'token_expired';
            } else if (reason.includes('nonce')) {
              vnode.state.error = 'token_already_used';
            } else {
              vnode.state.error = reason || 'SSO validation failed';
            }
          } else {
            vnode.state.error = error.reason || error.message || 'Login failed';
          }
        } else {
          vnode.state.status = 'success';
          
          // Redirect to home page after short delay
          setTimeout(() => {
            m.route.set('/');
          }, 1000);
        }
        m.redraw();
      }
    });
  },
  
  view(vnode) {
    const { status, error } = vnode.state;
    const hubUrl = Meteor.settings.public?.hubUrl || '#';
    
    return m('div.sso-callback', [
      status === 'processing' && [
        m('div.loading'),
        m('h2', 'Signing you in...')
      ],
      
      status === 'success' && [
        m('h2', '✓ Login Successful'),
        m('p', 'Redirecting to app...')
      ],
      
      status === 'error' && [
        m('h2', '✗ Login Failed'),
        
        error === 'token_expired' && [
          m('p', 'Your login link has expired. Please try again from the Hub.'),
          m('a.button', { href: hubUrl }, 'Return to Hub')
        ],
        
        error === 'token_already_used' && [
          m('p', 'This login link has already been used. Please request a new one from the Hub.'),
          m('a.button', { href: hubUrl }, 'Return to Hub')
        ],
        
        error && error !== 'token_expired' && error !== 'token_already_used' && [
          m('p', `Error: ${error}`),
          m('a.button', { href: hubUrl }, 'Return to Hub')
        ]
      ]
    ]);
  }
};
