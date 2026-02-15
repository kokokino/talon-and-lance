import { Meteor } from 'meteor/meteor';

// Import server modules
import './accounts.js';
import './publications.js';
import './methods.js';
import './indexes.js';
import './rateLimiting.js';
import './migrations/0_steps.js';

// Import game room methods and publications
import './methods/roomMethods.js';
import './methods/matchmakingMethods.js';
import './methods/highScoreMethods.js';
import './publications/roomPublications.js';
import './publications/highScorePublications.js';

// Import geckos.io relay bridge
import { initGeckosRelay } from './relay/geckosBridge.js';
import { startRoomCleanup } from './roomCleanup.js';

Meteor.startup(async () => {
  console.log('Talon & Lance started');
  
  // Verify required settings are present
  const settings = Meteor.settings;
  
  if (!settings.public?.hubUrl) {
    console.warn('Warning: settings.public.hubUrl is not configured');
  }
  
  if (!settings.private?.hubApiKey) {
    console.warn('Warning: settings.private.hubApiKey is not configured');
  }
  
  if (!settings.private?.hubPublicKey) {
    console.warn('Warning: settings.private.hubPublicKey is not configured');
  }

  // Initialize geckos.io relay for WebRTC fallback
  initGeckosRelay();

  // Start periodic room cleanup
  startRoomCleanup();
});
