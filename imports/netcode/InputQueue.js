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
  // Predictions are always (re-)computed from the current lastUserInput and written
  // to the ring buffer. This serves two purposes:
  //   1. confirmInput() can compare against the actual prediction for misprediction detection
  //   2. Rollback resimulation gets fresh predictions reflecting any newly confirmed inputs
  getInput(frame) {
    const index = frame % QUEUE_SIZE;

    if (frame <= this.lastAddedFrame) {
      if (!this.predicted[index]) {
        // Confirmed input — update prediction baseline so subsequent
        // predicted frames use this value. This is critical during rollback
        // resimulation where frames are processed sequentially: predictions
        // after a confirmed frame should repeat that confirmed input, not
        // a globally-latest confirmed input from a future frame.
        this.lastUserInput = this.inputs[index];
        return { input: this.inputs[index], predicted: false };
      }
      // Predicted frame — re-predict with current lastUserInput (may have
      // changed since original prediction due to newly confirmed inputs)
      this.inputs[index] = this.lastUserInput;
      return { input: this.lastUserInput, predicted: true };
    }

    // Frame beyond buffer — write predictions for gap and target frame
    for (let f = this.lastAddedFrame + 1; f <= frame; f++) {
      const fillIndex = f % QUEUE_SIZE;
      this.inputs[fillIndex] = this.lastUserInput;
      this.predicted[fillIndex] = true;
    }
    this.lastAddedFrame = frame;

    return { input: this.lastUserInput, predicted: true };
  }

  // Add a confirmed input, replacing any prediction that was there
  confirmInput(frame, input) {
    // Backfill any gap frames that getInput() hasn't reached yet.
    // Since getInput() now writes predictions to the ring buffer, gaps
    // only exist for frames beyond lastAddedFrame.
    if (frame > this.lastAddedFrame + 1) {
      const fillStart = this.lastAddedFrame + 1;
      for (let f = fillStart; f < frame; f++) {
        const fillIndex = f % QUEUE_SIZE;
        this.inputs[fillIndex] = this.lastUserInput;
        this.predicted[fillIndex] = true;
      }
    }

    const index = frame % QUEUE_SIZE;
    // If this frame was never written to the buffer, the slot contains stale
    // data from a wrapped-around frame. Treat it as predicted with lastUserInput
    // (matching what getInput() would have returned during simulation).
    const wasPredicted = (frame > this.lastAddedFrame) ? true : this.predicted[index];
    const oldInput = (frame > this.lastAddedFrame) ? this.lastUserInput : this.inputs[index];

    this.inputs[index] = input;
    this.predicted[index] = false;
    this.confirmedFrame = Math.max(this.confirmedFrame, frame);

    // Track the highest frame written to the ring buffer
    if (frame > this.lastAddedFrame) {
      this.lastAddedFrame = frame;
    }

    // Only update lastUserInput for the newest confirmed frame — out-of-order
    // arrivals for older frames must not regress the prediction baseline.
    // Uses confirmedFrame (not lastAddedFrame) because getInput() now
    // advances lastAddedFrame via predictions.
    if (frame >= this.confirmedFrame) {
      this.lastUserInput = input;
    }

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
