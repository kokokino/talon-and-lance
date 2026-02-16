// Orchestrates connections between peers
// Attempts PeerJS P2P first, falls back to geckos.io relay per-pair
// Exposes a unified interface to the rollback engine

import { PeerJSTransport } from './PeerJSTransport.js';
import { GeckosTransport } from './GeckosTransport.js';

const P2P_TIMEOUT = 3000; // 3 seconds to establish P2P before falling back

export class TransportManager {
  constructor() {
    this.p2pTransport = new PeerJSTransport();
    this.relayTransport = null; // initialized lazily if needed
    this.receiveCallback = null;

    // Track which transport each peer uses
    this.peerTransports = new Map(); // peerId -> 'p2p' | 'relay'
    this.pendingConnections = new Map(); // peerId -> timeout handle

    // Connection state callbacks
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onAllPeersConnected = null;

    this.expectedPeers = new Set();
    this.connectedPeers = new Set();

    this.serverUrl = null;
    this.roomId = null;
    this.userId = null;

    // Wire up P2P fallback
    this.p2pTransport.onFallbackNeeded = (peerId) => {
      this._handleP2PFailure(peerId);
    };

    // Wire up P2P receive handler
    this.p2pTransport.onReceive((peerId, data) => {
      if (this.receiveCallback) {
        this.receiveCallback(peerId, data);
      }
    });
  }

  // Initialize the transport manager
  // Returns the local PeerJS ID for sharing with other players
  async initialize(serverUrl, roomId, userId, options = {}) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.userId = userId;

    // Apply simulated latency to transports if specified
    if (options.simulatedLatencyMs > 0) {
      this.p2pTransport.simulatedLatencyMs = options.simulatedLatencyMs;
    }
    this._simulatedLatencyMs = options.simulatedLatencyMs || 0;

    const localPeerId = await this.p2pTransport.initialize();
    return localPeerId;
  }

  // Send data to a specific peer, using whichever transport is active for them
  send(peerId, data) {
    const transportType = this.peerTransports.get(peerId);

    if (transportType === 'relay' && this.relayTransport) {
      this.relayTransport.send(peerId, data);
    } else if (transportType === 'p2p') {
      this.p2pTransport.send(peerId, data);
    }
  }

  // Register a callback for receiving data from any peer
  onReceive(callback) {
    this.receiveCallback = callback;
  }

  // Connect to a list of peer IDs (e.g., from room data)
  // Tries P2P first, falls back to relay per-pair
  connectToPeers(peerIds) {
    for (const peerId of peerIds) {
      this.expectedPeers.add(peerId);
      this._connectToPeer(peerId);
    }
  }

  // Disconnect from a specific peer
  disconnect(peerId) {
    const transportType = this.peerTransports.get(peerId);

    if (transportType === 'p2p') {
      this.p2pTransport.disconnect(peerId);
    } else if (transportType === 'relay' && this.relayTransport) {
      this.relayTransport.disconnect(peerId);
    }

    this.peerTransports.delete(peerId);
    this.connectedPeers.delete(peerId);
    this.expectedPeers.delete(peerId);

    if (this.pendingConnections.has(peerId)) {
      clearTimeout(this.pendingConnections.get(peerId));
      this.pendingConnections.delete(peerId);
    }
  }

  // Check if connected to a specific peer
  isConnected(peerId) {
    const transportType = this.peerTransports.get(peerId);

    if (transportType === 'p2p') {
      return this.p2pTransport.isConnected(peerId);
    }
    if (transportType === 'relay' && this.relayTransport) {
      return this.relayTransport.isConnected(peerId);
    }

    return false;
  }

  // Check if all expected peers are connected
  allConnected() {
    for (const peerId of this.expectedPeers) {
      if (!this.connectedPeers.has(peerId)) {
        return false;
      }
    }
    return this.expectedPeers.size > 0;
  }

  // Get connection info for display
  getConnectionInfo() {
    const info = {};
    for (const [peerId, transportType] of this.peerTransports) {
      info[peerId] = {
        type: transportType,
        connected: this.isConnected(peerId),
      };
    }
    return info;
  }

  // Get our local PeerJS ID
  getLocalPeerId() {
    return this.p2pTransport.getLocalPeerId();
  }

  // Clean up everything
  destroy() {
    for (const [, timeout] of this.pendingConnections) {
      clearTimeout(timeout);
    }
    this.pendingConnections.clear();

    this.p2pTransport.destroy();
    if (this.relayTransport) {
      this.relayTransport.destroy();
    }

    this.peerTransports.clear();
    this.connectedPeers.clear();
    this.expectedPeers.clear();
  }

  // --- Private ---

  _connectToPeer(peerId) {
    // Try P2P first
    this.p2pTransport.connect(peerId);

    // Set up a timeout to check if P2P succeeded
    const timeout = setTimeout(() => {
      if (this.p2pTransport.isConnected(peerId)) {
        this.peerTransports.set(peerId, 'p2p');
        this.connectedPeers.add(peerId);
        this.pendingConnections.delete(peerId);
        this._notifyPeerConnected(peerId);
      } else {
        // P2P didn't connect in time — fall back to relay
        this._handleP2PFailure(peerId);
      }
    }, P2P_TIMEOUT);

    this.pendingConnections.set(peerId, timeout);

    // Also check immediately if already connected (e.g., incoming connection)
    // Poll a few times in the first 3 seconds
    const checkInterval = setInterval(() => {
      if (this.p2pTransport.isConnected(peerId) && !this.connectedPeers.has(peerId)) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        this.peerTransports.set(peerId, 'p2p');
        this.connectedPeers.add(peerId);
        this.pendingConnections.delete(peerId);
        this._notifyPeerConnected(peerId);
      }
    }, 200);

    // Stop polling after timeout
    setTimeout(() => clearInterval(checkInterval), P2P_TIMEOUT + 100);
  }

  async _handleP2PFailure(peerId) {
    // Already connected via some transport
    if (this.connectedPeers.has(peerId)) {
      return;
    }

    // Initialize relay transport if not yet done
    if (!this.relayTransport) {
      this.relayTransport = new GeckosTransport();
      if (this._simulatedLatencyMs > 0) {
        this.relayTransport.simulatedLatencyMs = this._simulatedLatencyMs;
      }

      try {
        await this.relayTransport.initialize(this.serverUrl, this.roomId, this.userId);
      } catch (err) {
        console.error('[TransportManager] Failed to initialize relay transport:', err);
        return;
      }

      // Wire up relay receive handler
      this.relayTransport.onReceive((fromPeerId, data) => {
        if (this.receiveCallback) {
          this.receiveCallback(fromPeerId, data);
        }
      });
    }

    // Connect via relay
    this.relayTransport.connect(peerId);
    this.peerTransports.set(peerId, 'relay');
    this.connectedPeers.add(peerId);
    this._notifyPeerConnected(peerId);
  }

  _notifyPeerConnected(peerId) {
    if (this.onPeerConnected) {
      this.onPeerConnected(peerId);
    }

    if (this.allConnected() && this.onAllPeersConnected) {
      this.onAllPeersConnected();
    }
  }
}
