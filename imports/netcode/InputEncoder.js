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
};

// Input bits
const INPUT_LEFT = 0x01;
const INPUT_RIGHT = 0x02;
const INPUT_FLAP = 0x04;

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

  // Encode an input message: [type(1B), frame(4B), playerIndex(1B), input(1B)]
  static encodeInputMessage(frame, playerIndex, input) {
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint8(0, MessageType.INPUT);
    view.setUint32(1, frame, true); // little-endian
    view.setUint8(5, playerIndex);
    view.setUint8(6, typeof input === 'number' ? input : InputEncoder.encodeInput(input));
    return buffer;
  }

  // Decode an input message
  static decodeInputMessage(buffer) {
    const view = new DataView(buffer);
    return {
      type: view.getUint8(0),
      frame: view.getUint32(1, true),
      playerIndex: view.getUint8(5),
      input: view.getUint8(6),
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

      default:
        return { type };
    }
  }
}
