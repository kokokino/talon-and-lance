// Fallback relay transport using geckos.io through the Meteor server
// Same interface as PeerJSTransport — rollback engine doesn't know the difference
// Messages are routed through the server to the target peer
// Message format: [targetPeerId(16B), payload] — server strips peerId and routes

import { Transport } from './Transport.js';

const PEER_ID_LENGTH = 16; // fixed-length peer ID in message header
const HEARTBEAT_INTERVAL = 1000; // 1 second
const HEARTBEAT_TIMEOUT = 3000; // consider dead after 3s without heartbeat
const HEARTBEAT_BYTE = 0xFF; // single-byte heartbeat message

export class GeckosTransport extends Transport {
  constructor() {
    super();
    this.channel = null;
    this.receiveCallback = null;
    this.connectedPeers = new Set();
    this.lastHeartbeat = new Map(); // peerId -> timestamp
    this.heartbeatInterval = null;
    this.serverUrl = null;
    this.simulatedLatencyMs = 0; // artificial one-way latency for testing
  }

  // Connect to the geckos.io server relay
  async initialize(serverUrl, roomId, userId) {
    const geckos = (await import('@geckos.io/client')).default;

    this.serverUrl = serverUrl;

    return new Promise((resolve, reject) => {
      this.channel = geckos({
        url: serverUrl,
        port: null, // uses the HTTP server port
        authorization: JSON.stringify({ roomId, userId }),
      });

      this.channel.onConnect((error) => {
        if (error) {
          reject(error);
          return;
        }

        // Start heartbeat monitoring
        this._startHeartbeat();

        resolve();
      });

      // Handle raw binary messages from server
      this.channel.onRaw((data) => {
        if (!(data instanceof ArrayBuffer) || data.byteLength <= PEER_ID_LENGTH) {
          return;
        }

        // Extract sender peer ID from header
        const headerView = new Uint8Array(data, 0, PEER_ID_LENGTH);
        const senderPeerId = this._decodePeerId(headerView);

        // Extract payload
        const payload = data.slice(PEER_ID_LENGTH);

        // Check if it's a heartbeat
        if (payload.byteLength === 1) {
          const view = new Uint8Array(payload);
          if (view[0] === HEARTBEAT_BYTE) {
            this.lastHeartbeat.set(senderPeerId, Date.now());
            return;
          }
        }

        // Update heartbeat timestamp on any data
        this.lastHeartbeat.set(senderPeerId, Date.now());

        if (this.receiveCallback) {
          if (this.simulatedLatencyMs > 0) {
            const delay = this.simulatedLatencyMs / 2;
            setTimeout(() => this.receiveCallback(senderPeerId, payload), delay);
          } else {
            this.receiveCallback(senderPeerId, payload);
          }
        }
      });

      this.channel.onDisconnect(() => {
        this.connectedPeers.clear();
        this.lastHeartbeat.clear();
      });
    });
  }

  send(peerId, data) {
    if (!this.channel) {
      return;
    }

    // Prepend target peer ID to payload
    const peerIdBytes = this._encodePeerId(peerId);
    const message = new ArrayBuffer(PEER_ID_LENGTH + data.byteLength);
    const messageView = new Uint8Array(message);
    messageView.set(peerIdBytes, 0);
    messageView.set(new Uint8Array(data), PEER_ID_LENGTH);

    if (this.simulatedLatencyMs > 0) {
      const delay = this.simulatedLatencyMs / 2;
      setTimeout(() => this.channel.raw.emit(message), delay);
    } else {
      this.channel.raw.emit(message);
    }
  }

  onReceive(callback) {
    this.receiveCallback = callback;
  }

  connect(peerId) {
    // For geckos relay, "connecting" to a peer just means tracking them
    // The actual connection is to the server, which routes to peers
    this.connectedPeers.add(peerId);
    this.lastHeartbeat.set(peerId, Date.now());
  }

  disconnect(peerId) {
    this.connectedPeers.delete(peerId);
    this.lastHeartbeat.delete(peerId);
  }

  getStats(peerId) {
    return {
      ping: -1, // RTT measured at higher level by TimeSync
      sendQueueLen: 0,
      relayed: true,
    };
  }

  isConnected(peerId) {
    return this.channel !== null && this.connectedPeers.has(peerId);
  }

  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.connectedPeers.clear();
    this.lastHeartbeat.clear();
  }

  // --- Private ---

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const heartbeatPayload = new ArrayBuffer(1);
      new Uint8Array(heartbeatPayload)[0] = HEARTBEAT_BYTE;

      for (const peerId of this.connectedPeers) {
        // Send heartbeat
        this.send(peerId, heartbeatPayload);

        // Check for dead peers
        const lastRecv = this.lastHeartbeat.get(peerId) || 0;
        if (lastRecv > 0 && (now - lastRecv) > HEARTBEAT_TIMEOUT) {
          this.connectedPeers.delete(peerId);
          this.lastHeartbeat.delete(peerId);
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  // Encode a peer ID string into fixed-length bytes
  _encodePeerId(peerId) {
    const bytes = new Uint8Array(PEER_ID_LENGTH);
    const str = String(peerId);
    for (let i = 0; i < Math.min(str.length, PEER_ID_LENGTH); i++) {
      bytes[i] = str.charCodeAt(i);
    }
    return bytes;
  }

  // Decode fixed-length bytes back into a peer ID string
  _decodePeerId(bytes) {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) {
        break;
      }
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }
}
