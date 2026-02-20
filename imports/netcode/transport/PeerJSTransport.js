// Primary P2P transport using PeerJS WebRTC DataChannels
// Configures unreliable/unordered delivery for lowest latency
// Includes heartbeat to detect dead connections

import { Transport } from './Transport.js';

const HEARTBEAT_INTERVAL = 1000; // 1 second
const HEARTBEAT_TIMEOUT = 3000; // consider dead after 3s without heartbeat
const CONNECTION_TIMEOUT = 3000; // give up connecting after 3s
const HEARTBEAT_BYTE = 0xFF; // single-byte heartbeat message

export class PeerJSTransport extends Transport {
  constructor() {
    super();
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.receiveCallback = null;
    this.onFallbackNeeded = null; // callback(peerId) when P2P fails
    this.lastHeartbeat = new Map(); // peerId -> timestamp
    this.heartbeatInterval = null;
    this.localPeerId = null;
    this.simulatedLatencyMs = 0; // artificial one-way latency for testing
  }

  // Initialize PeerJS with a specific ID (or let it auto-generate)
  async initialize(peerId) {
    const Peer = (await import('peerjs')).default;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId || undefined);

      this.peer.on('open', (id) => {
        this.localPeerId = id;

        // Listen for incoming connections
        this.peer.on('connection', (connection) => {
          this._setupConnection(connection);
        });

        // Start heartbeat monitoring
        this._startHeartbeat();

        resolve(id);
      });

      this.peer.on('error', (err) => {
        reject(err);
      });
    });
  }

  // Get our local PeerJS ID (needed for room data so others can connect to us)
  getLocalPeerId() {
    return this.localPeerId;
  }

  send(peerId, data) {
    const connection = this.connections.get(peerId);
    if (connection && connection.open) {
      if (this.simulatedLatencyMs > 0) {
        const delay = this.simulatedLatencyMs / 2;
        setTimeout(() => connection.send(data), delay);
      } else {
        connection.send(data);
      }
    }
  }

  onReceive(callback) {
    this.receiveCallback = callback;
  }

  connect(peerId) {
    if (this.connections.has(peerId)) {
      return; // already connected or connecting
    }

    const connection = this.peer.connect(peerId, {
      reliable: false, // unreliable for lower latency
      serialization: 'raw', // raw binary, no BinaryPack overhead
    });

    this._setupConnection(connection);

    // Set up connection timeout
    const timeout = setTimeout(() => {
      if (!connection.open) {
        connection.close();
        this.connections.delete(peerId);
        if (this.onFallbackNeeded) {
          this.onFallbackNeeded(peerId);
        }
      }
    }, CONNECTION_TIMEOUT);

    connection._connectTimeout = timeout;
  }

  disconnect(peerId) {
    const connection = this.connections.get(peerId);
    if (connection) {
      if (connection._connectTimeout) {
        clearTimeout(connection._connectTimeout);
      }
      try {
        connection.close();
      } catch (e) {
        // PeerJS throws if DataChannel was never created
      }
      this.connections.delete(peerId);
      this.lastHeartbeat.delete(peerId);
    }
  }

  getStats(peerId) {
    const connection = this.connections.get(peerId);
    if (!connection || !connection.open) {
      return { ping: -1, sendQueueLen: 0 };
    }

    return {
      ping: 0, // PeerJS doesn't expose RTT directly; TimeSync handles this
      sendQueueLen: connection.bufferSize || 0,
    };
  }

  isConnected(peerId) {
    const connection = this.connections.get(peerId);
    return connection !== undefined && connection.open;
  }

  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [peerId] of this.connections) {
      this.disconnect(peerId);
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        // PeerJS may throw during cleanup
      }
      this.peer = null;
    }
  }

  // --- Private ---

  _setupConnection(connection) {
    const peerId = connection.peer;
    this.connections.set(peerId, connection);

    connection.on('open', () => {
      // Configure the underlying DataChannel for binary
      if (connection.dataChannel) {
        connection.dataChannel.binaryType = 'arraybuffer';
      }

      if (connection._connectTimeout) {
        clearTimeout(connection._connectTimeout);
      }

      this.lastHeartbeat.set(peerId, Date.now());
    });

    connection.on('data', (data) => {
      // Check if it's a heartbeat
      if (data instanceof ArrayBuffer && data.byteLength === 1) {
        const view = new Uint8Array(data);
        if (view[0] === HEARTBEAT_BYTE) {
          this.lastHeartbeat.set(peerId, Date.now());
          return;
        }
      }

      this.lastHeartbeat.set(peerId, Date.now());

      if (this.receiveCallback && data instanceof ArrayBuffer) {
        if (this.simulatedLatencyMs > 0) {
          const delay = this.simulatedLatencyMs / 2;
          setTimeout(() => this.receiveCallback(peerId, data), delay);
        } else {
          this.receiveCallback(peerId, data);
        }
      }
    });

    connection.on('close', () => {
      this.connections.delete(peerId);
      this.lastHeartbeat.delete(peerId);
    });

    connection.on('error', () => {
      this.connections.delete(peerId);
      this.lastHeartbeat.delete(peerId);
      if (this.onFallbackNeeded) {
        this.onFallbackNeeded(peerId);
      }
    });
  }

  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const heartbeatBuffer = new ArrayBuffer(1);
      new Uint8Array(heartbeatBuffer)[0] = HEARTBEAT_BYTE;

      for (const [peerId, connection] of this.connections) {
        if (connection.open) {
          // Send heartbeat
          connection.send(heartbeatBuffer);

          // Check for dead connections
          const lastRecv = this.lastHeartbeat.get(peerId) || 0;
          if (lastRecv > 0 && (now - lastRecv) > HEARTBEAT_TIMEOUT) {
            connection.close();
            this.connections.delete(peerId);
            this.lastHeartbeat.delete(peerId);
          }
        }
      }
    }, HEARTBEAT_INTERVAL);
  }
}
