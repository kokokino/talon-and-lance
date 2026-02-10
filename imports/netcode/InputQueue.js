// Per-player input ring buffer
// Stores inputs indexed by frame number, tracks confirmed vs predicted

const QUEUE_SIZE = 128;

export class InputQueue {
  constructor() {
    this.inputs = new Array(QUEUE_SIZE);
    this.predicted = new Array(QUEUE_SIZE);
    this.confirmedFrame = -1;
    this.lastAddedFrame = -1;
    this.lastUserInput = 0;

    for (let i = 0; i < QUEUE_SIZE; i++) {
      this.inputs[i] = 0;
      this.predicted[i] = false;
    }
  }

  // Add a confirmed or predicted input for a specific frame
  addInput(frame, input, isPredicted) {
    const index = frame % QUEUE_SIZE;
    this.inputs[index] = input;
    this.predicted[index] = isPredicted;

    if (!isPredicted) {
      this.confirmedFrame = Math.max(this.confirmedFrame, frame);
      this.lastUserInput = input;
    }

    if (frame > this.lastAddedFrame) {
      this.lastAddedFrame = frame;
    }
  }

  // Get input for a specific frame. If no input exists, predict using last confirmed.
  getInput(frame) {
    const index = frame % QUEUE_SIZE;

    if (frame <= this.lastAddedFrame) {
      return {
        input: this.inputs[index],
        predicted: this.predicted[index],
      };
    }

    // Frame not yet received — predict by repeating last known input
    return {
      input: this.lastUserInput,
      predicted: true,
    };
  }

  // Add a confirmed input, replacing any prediction that was there
  confirmInput(frame, input) {
    const index = frame % QUEUE_SIZE;
    const wasPredicted = this.predicted[index];
    const oldInput = this.inputs[index];

    this.inputs[index] = input;
    this.predicted[index] = false;
    this.confirmedFrame = Math.max(this.confirmedFrame, frame);
    this.lastUserInput = input;

    // Return whether this caused a misprediction
    return wasPredicted && oldInput !== input;
  }

  // Check if a specific frame had a misprediction (input was predicted and later confirmed differently)
  getConfirmedFrame() {
    return this.confirmedFrame;
  }

  // Reset the queue
  reset() {
    for (let i = 0; i < QUEUE_SIZE; i++) {
      this.inputs[i] = 0;
      this.predicted[i] = false;
    }
    this.confirmedFrame = -1;
    this.lastAddedFrame = -1;
    this.lastUserInput = 0;
  }
}
