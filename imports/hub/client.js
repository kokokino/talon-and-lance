import { Meteor } from 'meteor/meteor';

/**
 * Hub API Client
 * Handles communication with the Hub app's API endpoints
 */

const getHubApiUrl = () => {
  return Meteor.settings.private?.hubApiUrl || 
         (Meteor.settings.public?.hubUrl + '/api/spoke');
};

const getHubApiKey = () => {
  return Meteor.settings.private?.hubApiKey;
};

/**
 * Make an authenticated request to the Hub API
 */
export async function hubApiRequest(endpoint, data = {}) {
  const apiUrl = getHubApiUrl();
  const apiKey = getHubApiKey();
  
  if (!apiUrl || !apiKey) {
    throw new Error('Hub API not configured');
  }
  
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'unknown_error' }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

/**
 * Validate an SSO token with the Hub
 */
export async function validateToken(token) {
  return hubApiRequest('/validate-token', { token });
}

/**
 * Check subscription status for a user
 */
export async function checkSubscriptionWithHub(userId, requiredProductSlugs) {
  return hubApiRequest('/check-subscription', { userId, requiredProductSlugs });
}

/**
 * Get user info from Hub
 */
export async function getUserInfo(userId) {
  return hubApiRequest('/user-info', { userId });
}

/**
 * Get the Hub's public key for JWT verification
 * This endpoint doesn't require authentication
 */
export async function getHubPublicKey() {
  const hubUrl = Meteor.settings.public?.hubUrl;
  
  if (!hubUrl) {
    throw new Error('Hub URL not configured');
  }
  
  const response = await fetch(`${hubUrl}/api/public-key`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch public key: HTTP ${response.status}`);
  }
  
  return response.json();
}
