// geckos.io server integration for WebRTC relay fallback
// Attaches to Meteor's HTTP server
// Routes messages between players in the same game room
// Only used when P2P connections fail (~15% of players behind restrictive NATs)

import { WebApp } from 'meteor/webapp';

const PEER_ID_LENGTH = 16;

// Track active relay connections per room
// roomId -> Map<userId, channel>
const roomChannels = new Map();

export function initGeckosRelay() {
  let io;

  try {
    // Dynamic import — geckos.io/server is only needed if relay is used
    const geckos = require('@geckos.io/server').default;
    io = geckos();
  } catch (err) {
    console.warn('[GeckosBridge] @geckos.io/server not available, relay disabled:', err.message);
    return;
  }

  io.addServer(WebApp.httpServer);

  io.onConnection((channel) => {
    let roomId = null;
    let userId = null;

    // Parse authorization metadata
    try {
      const auth = JSON.parse(channel.userData || '{}');
      roomId = auth.roomId;
      userId = auth.userId;
    } catch (err) {
      console.error('[GeckosBridge] Failed to parse auth:', err);
      channel.close();
      return;
    }

    if (!roomId || !userId) {
      channel.close();
      return;
    }

    // Register this channel for the room
    if (!roomChannels.has(roomId)) {
      roomChannels.set(roomId, new Map());
    }
    roomChannels.get(roomId).set(userId, channel);

    // Handle raw binary messages
    // Message format: [targetPeerId(16B), payload]
    channel.onRaw((data) => {
      if (!(data instanceof ArrayBuffer) || data.byteLength <= PEER_ID_LENGTH) {
        return;
      }

      // Extract target peer ID from message header
      const headerView = new Uint8Array(data, 0, PEER_ID_LENGTH);
      const targetPeerId = decodePeerId(headerView);

      // Extract payload
      const payload = data.slice(PEER_ID_LENGTH);

      // Find target channel in this room
      const room = roomChannels.get(roomId);
      if (!room) {
        return;
      }

      // Find the channel by peer ID
      // The target peer ID from the header maps to a userId
      // We iterate room channels to find the match
      for (const [otherUserId, otherChannel] of room) {
        if (otherUserId === targetPeerId || otherChannel.id === targetPeerId) {
          // Prepend sender's user ID so recipient knows who it's from
          const senderIdBytes = encodePeerId(userId);
          const forwarded = new ArrayBuffer(PEER_ID_LENGTH + payload.byteLength);
          const forwardedView = new Uint8Array(forwarded);
          forwardedView.set(senderIdBytes, 0);
          forwardedView.set(new Uint8Array(payload), PEER_ID_LENGTH);

          otherChannel.raw.emit(forwarded);
          break;
        }
      }
    });

    // Clean up on disconnect
    channel.onDisconnect(() => {
      const room = roomChannels.get(roomId);
      if (room) {
        room.delete(userId);
        if (room.size === 0) {
          roomChannels.delete(roomId);
        }
      }
    });
  });

  console.log('[GeckosBridge] Relay server initialized');
}

function encodePeerId(peerId) {
  const bytes = new Uint8Array(PEER_ID_LENGTH);
  const str = String(peerId);
  for (let i = 0; i < Math.min(str.length, PEER_ID_LENGTH); i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

function decodePeerId(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      break;
    }
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}
