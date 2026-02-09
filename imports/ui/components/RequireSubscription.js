import m from 'mithril';
import { Meteor } from 'meteor/meteor';

/**
 * Higher-order component that requires both authentication and subscription
 * Redirects to appropriate page if requirements not met
 */
export const RequireSubscription = {
  oninit(vnode) {
    this.hasAccess = null;
    this.checking = true;
    this.checkAccess(vnode);
  },
  
  onupdate(vnode) {
    // Re-check if user changes
    if (!Meteor.loggingIn() && this.lastUserId !== Meteor.userId()) {
      this.checkAccess(vnode);
    }
  },
  
  async checkAccess(vnode) {
    this.lastUserId = Meteor.userId();
    
    // Don't check while logging in
    if (Meteor.loggingIn()) {
      return;
    }
    
    // Check if logged in
    if (!Meteor.userId()) {
      m.route.set('/not-logged-in');
      return;
    }
    
    // Get required products from props or settings
    const requiredProducts = vnode.attrs.requiredProducts || 
                            Meteor.settings.public?.requiredProducts || 
                            [];
    
    // If no products required, grant access
    if (requiredProducts.length === 0) {
      this.hasAccess = true;
      this.checking = false;
      m.redraw();
      return;
    }
    
    // Check subscription via method
    try {
      this.hasAccess = await Meteor.callAsync('user.hasAccess', requiredProducts);
      this.checking = false;
      
      if (!this.hasAccess) {
        m.route.set('/no-subscription');
      }
    } catch (error) {
      console.error('Subscription check failed:', error);
      this.hasAccess = false;
      this.checking = false;
      m.route.set('/no-subscription');
    }
    
    m.redraw();
  },
  
  view(vnode) {
    // Show loading while checking
    if (Meteor.loggingIn() || this.checking) {
      return m('div.loading');
    }
    
    // Don't render if no access
    if (!this.hasAccess) {
      return null;
    }
    
    // Render children
    return vnode.children;
  }
};
