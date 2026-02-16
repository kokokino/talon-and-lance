// Frame timing and advantage balancing between peers
// Tracks local vs remote frame counts and recommends frame skips
// when the local client gets too far ahead of remotes

const HISTORY_SIZE = 32; // running average window

export class TimeSync {
  constructor(numPlayers, localPlayerIndex) {
    this.numPlayers = numPlayers;
    this.localPlayerIndex = localPlayerIndex;

    // Per-peer tracking
    this.remoteFrames = new Array(numPlayers).fill(0);
    this.roundTripTimes = new Array(numPlayers).fill(0);
    this.localFrameAdvantages = new Array(numPlayers).fill(0);
    this.remoteFrameAdvantages = new Array(numPlayers).fill(0);

    // Running average history for smoothing
    this.rttHistory = [];
    for (let i = 0; i < numPlayers; i++) {
      this.rttHistory.push(new Array(HISTORY_SIZE).fill(0));
    }
    this.rttHistoryIndex = new Array(numPlayers).fill(0);

    this.localFrame = 0;
  }

  // Update the local frame counter
  setLocalFrame(frame) {
    this.localFrame = frame;
  }

  // Called when we receive a frame update from a remote peer
  updateRemoteFrame(peerIndex, remoteFrame) {
    this.remoteFrames[peerIndex] = Math.max(this.remoteFrames[peerIndex], remoteFrame);
    this.localFrameAdvantages[peerIndex] = this.localFrame - this.remoteFrames[peerIndex];
  }

  // Called when we receive a quality report from a remote peer
  updateRemoteAdvantage(peerIndex, remoteAdvantage) {
    this.remoteFrameAdvantages[peerIndex] = remoteAdvantage;
  }

  // Record a round-trip time measurement for a peer
  updateRoundTripTime(peerIndex, rtt) {
    const histIndex = this.rttHistoryIndex[peerIndex] % HISTORY_SIZE;
    this.rttHistory[peerIndex][histIndex] = rtt;
    this.rttHistoryIndex[peerIndex]++;

    // Update running average
    const history = this.rttHistory[peerIndex];
    let sum = 0;
    const count = Math.min(this.rttHistoryIndex[peerIndex], HISTORY_SIZE);
    for (let i = 0; i < count; i++) {
      sum += history[i];
    }
    this.roundTripTimes[peerIndex] = Math.floor(sum / count);
  }

  // Calculate the frame advantage for a specific peer
  getFrameAdvantage(peerIndex) {
    return this.localFrameAdvantages[peerIndex];
  }

  // Get the recommended input delay based on average RTT (in frames at 60fps)
  getRecommendedInputDelay(peerIndex) {
    const rttMs = this.roundTripTimes[peerIndex];
    const oneWayFrames = Math.ceil((rttMs / 2) / (1000 / 60));
    return Math.max(1, Math.min(oneWayFrames, 15)); // clamp 1-15
  }

  // Check if we should wait (skip frames) to let remote peers catch up
  // Returns number of frames to wait, or 0 if no wait needed
  recommendFrameWait() {
    let maxAdvantage = 0;
    let maxAllowedAdvantage = 2; // default for low latency

    for (let i = 0; i < this.numPlayers; i++) {
      if (i === this.localPlayerIndex) {
        continue;
      }

      // Our advantage vs this peer is how far ahead we are
      const localAdv = this.localFrameAdvantages[i];
      const remoteAdv = this.remoteFrameAdvantages[i];
      const advantage = localAdv - remoteAdv;

      if (advantage > maxAdvantage) {
        maxAdvantage = advantage;
      }

      // Scale threshold based on measured RTT for this peer
      const recommendedDelay = this.getRecommendedInputDelay(i);
      if (recommendedDelay > maxAllowedAdvantage) {
        maxAllowedAdvantage = recommendedDelay;
      }
    }

    if (maxAdvantage > maxAllowedAdvantage) {
      return Math.min(maxAdvantage - maxAllowedAdvantage, 4);
    }

    return 0;
  }

  // Get average ping to a peer in milliseconds
  getPing(peerIndex) {
    return this.roundTripTimes[peerIndex];
  }

  // Build a quality report for sending to a remote peer
  buildQualityReport(peerIndex) {
    return {
      frame: this.localFrame,
      ping: this.roundTripTimes[peerIndex],
      frameAdvantage: this.localFrameAdvantages[peerIndex],
    };
  }

  // Reset all state
  reset() {
    this.remoteFrames.fill(0);
    this.roundTripTimes.fill(0);
    this.localFrameAdvantages.fill(0);
    this.remoteFrameAdvantages.fill(0);
    this.rttHistoryIndex.fill(0);
    this.localFrame = 0;

    for (let i = 0; i < this.numPlayers; i++) {
      this.rttHistory[i].fill(0);
    }
  }
}
