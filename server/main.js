import { Meteor } from 'meteor/meteor';

// Import server modules
import './accounts.js';
import './publications.js';
import './methods.js';
import './indexes.js';
import './rateLimiting.js';
import './migrations/0_steps.js';

Meteor.startup(async () => {
  console.log('Spoke App Skeleton started');
  
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
});
