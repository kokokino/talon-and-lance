import { Meteor } from 'meteor/meteor';
import { checkSubscriptionWithHub } from './client.js';
import { SubscriptionCache } from '../api/collections.js';

// Cache TTL in milliseconds (must match TTL index in server/indexes.js)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a user has the required subscriptions
 * @param {string} meteorUserId - The local Meteor user ID
 * @param {string[]} requiredProductSlugs - Array of required product slugs
 * @returns {boolean} - Whether the user has access
 */
export async function checkSubscription(meteorUserId, requiredProductSlugs = []) {
  // If no products required, always grant access
  if (!requiredProductSlugs || requiredProductSlugs.length === 0) {
    return true;
  }
  
  // Get user's subscription data
  const user = await Meteor.users.findOneAsync(meteorUserId);
  if (!user) {
    return false;
  }
  
  const subscriptions = user.subscriptions || [];
  const hubUserId = user.services?.sso?.hubUserId;
  
  // Check local subscription data first
  const hasLocalAccess = checkLocalSubscriptions(subscriptions, requiredProductSlugs);
  
  if (hasLocalAccess) {
    return true;
  }
  
  // If no local access, try to refresh from Hub
  if (hubUserId) {
    try {
      const freshData = await refreshSubscriptionFromHub(meteorUserId, hubUserId, requiredProductSlugs);
      return freshData.hasAccess;
    } catch (error) {
      console.error('Failed to refresh subscription from Hub:', error);
      // Fall back to local data
      return hasLocalAccess;
    }
  }
  
  return false;
}

/**
 * Check subscriptions against local cached data
 */
function checkLocalSubscriptions(subscriptions, requiredProductSlugs) {
  if (!subscriptions || subscriptions.length === 0) {
    return false;
  }

  const now = new Date();

  // Check if user has any of the required products with active status
  return requiredProductSlugs.some(requiredSlug => {
    return subscriptions.some(sub => {
      if (sub.productSlug !== requiredSlug) return false;
      if (sub.status !== 'active') return false;
      if (sub.validUntil && new Date(sub.validUntil) < now) return false;
      return true;
    });
  });
}

/**
 * Refresh subscription data from Hub API
 */
async function refreshSubscriptionFromHub(meteorUserId, hubUserId, requiredProductSlugs) {
  // Check cache first
  const cacheKey = `${hubUserId}:${requiredProductSlugs.join(',')}`;
  const cached = await SubscriptionCache.findOneAsync({ _id: cacheKey });

  if (cached && Date.now() - cached.createdAt.getTime() < CACHE_TTL_MS) {
    return cached.data;
  }

  // Call Hub API
  const result = await checkSubscriptionWithHub(hubUserId, requiredProductSlugs);

  // Update local user data
  if (result.subscriptions) {
    await Meteor.users.updateAsync(meteorUserId, {
      $set: {
        subscriptions: result.subscriptions
      }
    });
  }

  // Cache the result (upsert to handle both insert and update)
  await SubscriptionCache.upsertAsync(
    { _id: cacheKey },
    { $set: { data: result, createdAt: new Date() } }
  );

  return result;
}

/**
 * Clear subscription cache for a user
 */
export async function clearSubscriptionCache(hubUserId) {
  // Remove all cache entries that start with the hubUserId
  await SubscriptionCache.removeAsync({ _id: { $regex: `^${hubUserId}:` } });
}

/**
 * Get required products from settings
 */
export function getRequiredProducts() {
  return Meteor.settings.public?.requiredProducts || [];
}
