import m from 'mithril';
import { Meteor } from 'meteor/meteor';

/**
 * Higher-order component that requires authentication
 * Redirects to /not-logged-in if user is not authenticated
 */
export const RequireAuth = {
  oninit(vnode) {
    this.checkAuth();
  },
  
  onupdate(vnode) {
    this.checkAuth();
  },
  
  checkAuth() {
    // Don't redirect while still loading
    if (Meteor.loggingIn()) {
      return;
    }
    
    // Redirect if not logged in
    if (!Meteor.userId()) {
      m.route.set('/not-logged-in');
    }
  },
  
  view(vnode) {
    // Show loading while checking auth
    if (Meteor.loggingIn()) {
      return m('div.loading');
    }
    
    // Don't render children if not logged in
    if (!Meteor.userId()) {
      return null;
    }
    
    // Render children
    return vnode.children;
  }
};
