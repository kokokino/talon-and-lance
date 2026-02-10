// Transport interface
// All transports (PeerJS P2P, geckos.io relay) implement this interface
// so the rollback engine doesn't care how data gets between peers

export class Transport {
  // Send an ArrayBuffer to a specific peer
  // eslint-disable-next-line no-unused-vars
  send(peerId, data) {
    throw new Error('Transport.send() not implemented');
  }

  // Register a callback for receiving data: callback(peerId, ArrayBuffer)
  // eslint-disable-next-line no-unused-vars
  onReceive(callback) {
    throw new Error('Transport.onReceive() not implemented');
  }

  // Initiate a connection to a peer
  // eslint-disable-next-line no-unused-vars
  connect(peerId) {
    throw new Error('Transport.connect() not implemented');
  }

  // Close connection to a peer
  // eslint-disable-next-line no-unused-vars
  disconnect(peerId) {
    throw new Error('Transport.disconnect() not implemented');
  }

  // Get connection stats for a peer: { ping, sendQueueLen }
  // eslint-disable-next-line no-unused-vars
  getStats(peerId) {
    return { ping: 0, sendQueueLen: 0 };
  }

  // Check if connected to a specific peer
  // eslint-disable-next-line no-unused-vars
  isConnected(peerId) {
    return false;
  }

  // Clean up all connections
  destroy() {
    throw new Error('Transport.destroy() not implemented');
  }
}
