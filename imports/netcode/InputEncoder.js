// Binary input serialization for network messages
// Input format for Joust: { left, right, flap } = 3 bits per player
// Message types sent over the wire between peers

export const MessageType = {
  INPUT: 0x01,
  INPUT_ACK: 0x02,
  SYNC_REQUEST: 0x03,
  SYNC_RESPONSE: 0x04,
  QUALITY_REPORT: 0x05,
  QUALITY_REPLY: 0x06,
  STATE_SYNC: 0x07,
  CHECKSUM: 0x08,
  RESYNC_REQUEST: 0x09,
};

// Input bits
const INPUT_LEFT = 0x01;
const INPUT_RIGHT = 0x02;
const INPUT_FLAP = 0x04;
export const DISCONNECT_BIT = 0x08;

export class InputEncoder {
  // Encode a game input object { left, right, flap } into a single byte
  static encodeInput(input) {
    let encoded = 0;
    if (input.left) { encoded |= INPUT_LEFT; }
    if (input.right) { encoded |= INPUT_RIGHT; }
    if (input.flap) { encoded |= INPUT_FLAP; }
    return encoded;
  }

  // Decode a single byte back into { left, right, flap }
  static decodeInput(encoded) {
    return {
      left: (encoded & INPUT_LEFT) !== 0,
      right: (encoded & INPUT_RIGHT) !== 0,
      flap: (encoded & INPUT_FLAP) !== 0,
    };
  }

  // Encode an input message with redundancy:
  // [type(1B), frame(4B), playerIndex(1B), count(1B), input0(1B), ..., inputN-1(1B)]
  // input0 = input for `frame`, input1 = input for `frame-1`, etc.
  // Accepts a single input (number/object) or an array of inputs (newest first).
  static encodeInputMessage(frame, playerIndex, inputs) {
    const inputArray = Array.isArray(inputs) ? inputs : [inputs];
    const count = inputArray.length;
    const buffer = new ArrayBuffer(7 + count);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.INPUT);
    view.setUint32(1, frame, true); // little-endian
    view.setUint8(5, playerIndex);
    view.setUint8(6, count);
    for (let i = 0; i < count; i++) {
      view.setUint8(7 + i, typeof inputArray[i] === 'number'
        ? inputArray[i]
        : InputEncoder.encodeInput(inputArray[i]));
    }
    return buffer;
  }

  // Decode an input message with redundancy.
  // IMPORTANT: The decoder assumes inputs are for contiguous descending frames:
  // [frame, frame-1, frame-2, ...]. The encoder does not enforce this — it
  // trusts the caller to provide inputs in newest-first order from consecutive
  // frames. The single caller (GameLoop._tick) builds from _recentLocalInputs
  // which stores one input per frame, satisfying this contract.
  static decodeInputMessage(buffer) {
    const view = new DataView(buffer);
    const frame = view.getUint32(1, true);
    const playerIndex = view.getUint8(5);
    const count = view.getUint8(6);
    const inputs = [];
    for (let i = 0; i < count; i++) {
      inputs.push({ frame: frame - i, input: view.getUint8(7 + i) });
    }
    return {
      type: view.getUint8(0),
      frame,
      playerIndex,
      input: view.getUint8(7), // backward compat: first input
      inputs,
    };
  }

  // Encode an input ack: [type(1B), frame(4B)]
  static encodeInputAck(frame) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.INPUT_ACK);
    view.setUint32(1, frame, true);
    return buffer;
  }

  // Encode a sync request: [type(1B), randomValue(4B)]
  static encodeSyncRequest(randomValue) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.SYNC_REQUEST);
    view.setUint32(1, randomValue, true);
    return buffer;
  }

  // Encode a sync response: [type(1B), randomValue(4B)]
  static encodeSyncResponse(randomValue) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.SYNC_RESPONSE);
    view.setUint32(1, randomValue, true);
    return buffer;
  }

  // Encode a quality report: [type(1B), frame(4B), ping(2B), frameAdvantage(1B signed)]
  static encodeQualityReport(frame, ping, frameAdvantage) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.QUALITY_REPORT);
    view.setUint32(1, frame, true);
    view.setUint16(5, ping, true);
    view.setInt8(7, frameAdvantage);
    return buffer;
  }

  // Encode a quality reply: [type(1B), pong(2B)]
  static encodeQualityReply(pong) {
    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.QUALITY_REPLY);
    view.setUint16(1, pong, true);
    return buffer;
  }

  // Encode a state sync message: [type(1B), frame(4B), stateData(NB)]
  static encodeStateSyncMessage(frame, stateBuffer) {
    const stateBytes = new Uint8Array(stateBuffer);
    const buffer = new ArrayBuffer(5 + stateBytes.length);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.STATE_SYNC);
    view.setUint32(1, frame, true);
    new Uint8Array(buffer).set(stateBytes, 5);
    return buffer;
  }

  // Decode a state sync message
  static decodeStateSyncMessage(buffer) {
    const view = new DataView(buffer);
    const frame = view.getUint32(1, true);
    const stateData = buffer.slice(5);
    return { type: MessageType.STATE_SYNC, frame, stateData };
  }

  // Encode a checksum message: [type(1B), frame(4B), checksum(4B)]
  static encodeChecksumMessage(frame, checksum) {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.CHECKSUM);
    view.setUint32(1, frame, true);
    view.setUint32(5, checksum, true);
    return buffer;
  }

  // Decode a checksum message
  static decodeChecksumMessage(buffer) {
    const view = new DataView(buffer);
    return {
      type: MessageType.CHECKSUM,
      frame: view.getUint32(1, true),
      checksum: view.getUint32(5, true),
    };
  }

  // Encode a resync request: [type(1B), frame(4B)]
  static encodeResyncRequest(frame) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.RESYNC_REQUEST);
    view.setUint32(1, frame, true);
    return buffer;
  }

  // Get message type from any buffer
  static getMessageType(buffer) {
    const view = new DataView(buffer);
    return view.getUint8(0);
  }

  // Decode any message based on its type byte
  static decode(buffer) {
    const view = new DataView(buffer);
    const type = view.getUint8(0);

    switch (type) {
      case MessageType.INPUT:
        return InputEncoder.decodeInputMessage(buffer);

      case MessageType.INPUT_ACK:
        return { type, frame: view.getUint32(1, true) };

      case MessageType.SYNC_REQUEST:
        return { type, randomValue: view.getUint32(1, true) };

      case MessageType.SYNC_RESPONSE:
        return { type, randomValue: view.getUint32(1, true) };

      case MessageType.QUALITY_REPORT:
        return {
          type,
          frame: view.getUint32(1, true),
          ping: view.getUint16(5, true),
          frameAdvantage: view.getInt8(7),
        };

      case MessageType.QUALITY_REPLY:
        return { type, pong: view.getUint16(1, true) };

      case MessageType.STATE_SYNC:
        return InputEncoder.decodeStateSyncMessage(buffer);

      case MessageType.CHECKSUM:
        return InputEncoder.decodeChecksumMessage(buffer);

      case MessageType.RESYNC_REQUEST:
        return { type, frame: view.getUint32(1, true) };

      default:
        return { type };
    }
  }
}
