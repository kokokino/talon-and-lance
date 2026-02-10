import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import './main.html';

// Import Pico CSS directly from node_modules
import '@picocss/pico/css/pico.min.css';

// Import pages
import { MainLayout } from '../imports/ui/layouts/MainLayout.js';
import { HomePage } from '../imports/ui/pages/HomePage.js';
import { NotLoggedIn } from '../imports/ui/pages/NotLoggedIn.js';
import { NoSubscription } from '../imports/ui/pages/NoSubscription.js';
import { SessionExpired } from '../imports/ui/pages/SessionExpired.js';
import { SsoCallback } from '../imports/ui/pages/SsoCallback.js';
import { BabylonPage } from '../imports/ui/pages/BabylonPage.js';

// Import collections for subscriptions
import '../imports/lib/collections/chatMessages.js';
import '../imports/lib/collections/gameRooms.js';

// Layout wrapper component (includes MeteorWrapper reactivity)
const MeteorWrapper = {
  oninit() {
    this.computation = null;
  },
  oncreate() {
    this.computation = Tracker.autorun(() => {
      Meteor.user();
      Meteor.userId();
      Meteor.loggingIn();
      m.redraw();
    });
  },
  onremove() {
    if (this.computation) {
      this.computation.stop();
    }
  },
  view(vnode) {
    return vnode.children;
  }
};

// Layout wrapper for Mithril pages that wraps in MainLayout + MeteorWrapper
const Layout = {
  view(vnode) {
    return m(MeteorWrapper, m(MainLayout, vnode.attrs, vnode.children));
  }
};

// Route resolver that wraps pages in layout
function layoutRoute(component, attrs = {}) {
  return {
    render() {
      return m(Layout, attrs, m(component));
    }
  };
}

// Initialize Mithril routing
function initializeApp() {
  const root = document.getElementById('app');

  m.route.prefix = '';

  m.route(root, '/', {
    '/': {
      render() {
        if (Meteor.loggingIn()) {
          return m('div.loading');
        }
        if (Meteor.userId()) {
          return m(BabylonPage);
        }
        return m(Layout, m(HomePage));
      }
    },
    '/not-logged-in': layoutRoute(NotLoggedIn),
    '/no-subscription': layoutRoute(NoSubscription),
    '/session-expired': layoutRoute(SessionExpired),
    '/sso': {
      render() {
        return m(SsoCallback);
      }
    }
  });
}

// Initialize app when DOM is ready
Meteor.startup(() => {
  // Global reactivity bridge — ensures Mithril redraws on auth state changes
  // This runs regardless of which route is active
  Tracker.autorun(() => {
    Meteor.user();
    Meteor.userId();
    Meteor.loggingIn();
    m.redraw();
  });

  initializeApp();
});
