// Unit tests for InputQueue prediction baseline bug fix.
// Verifies that getInput() writes predictions to the ring buffer so that
// confirmInput() can accurately detect mispredictions even when confirmed
// inputs arrive out of order with multi-frame gaps.

import assert from 'assert';
import { InputQueue } from '../InputQueue.js';

describe('InputQueue', function () {
  describe('prediction baseline bug', function () {
    it('detects mispredictions when confirmInput arrives out of order', function () {
      // This exercises the exact bug scenario:
      //   lastUserInput=0, lastAddedFrame=-1
      //   Simulate frames 0-7 (getInput returns 0 for each)
      //   confirmInput(3, 0x01): prediction was 0 → misprediction
      //   confirmInput(7, 0x02): prediction was 0 → misprediction
      //   confirmInput(5, 0x01): prediction was 0 → misprediction
      // Before fix: confirmInput(7) shifted lastUserInput to 0x01, then
      // gap-fill for frame 5 wrote 0x01, masking the misprediction.

      const queue = new InputQueue();

      // Simulate frames 0 through 7 — all predicted as 0
      for (let f = 0; f <= 7; f++) {
        const result = queue.getInput(f);
        assert.strictEqual(result.input, 0, `frame ${f} should predict 0`);
        assert.strictEqual(result.predicted, true, `frame ${f} should be predicted`);
      }

      // Confirm frame 3 with 0x01 — prediction was 0, so misprediction
      const mis3 = queue.confirmInput(3, 0x01);
      assert.strictEqual(mis3, true, 'frame 3: predicted 0, confirmed 0x01 → misprediction');

      // Confirm frame 7 with 0x02 — prediction was 0, so misprediction
      const mis7 = queue.confirmInput(7, 0x02);
      assert.strictEqual(mis7, true, 'frame 7: predicted 0, confirmed 0x02 → misprediction');

      // Confirm frame 5 with 0x01 — prediction was 0, so misprediction
      const mis5 = queue.confirmInput(5, 0x01);
      assert.strictEqual(mis5, true, 'frame 5: predicted 0, confirmed 0x01 → misprediction');
    });

    it('returns no misprediction when confirmed input matches prediction', function () {
      const queue = new InputQueue();

      // Predict frames 0-3 as 0
      for (let f = 0; f <= 3; f++) {
        queue.getInput(f);
      }

      // Confirm with the same value that was predicted (0)
      const mis0 = queue.confirmInput(0, 0);
      assert.strictEqual(mis0, false, 'frame 0: predicted 0, confirmed 0 → no misprediction');

      const mis1 = queue.confirmInput(1, 0);
      assert.strictEqual(mis1, false, 'frame 1: predicted 0, confirmed 0 → no misprediction');

      const mis2 = queue.confirmInput(2, 0);
      assert.strictEqual(mis2, false, 'frame 2: predicted 0, confirmed 0 → no misprediction');

      const mis3 = queue.confirmInput(3, 0);
      assert.strictEqual(mis3, false, 'frame 3: predicted 0, confirmed 0 → no misprediction');
    });
  });

  describe('rollback re-prediction', function () {
    it('re-predicts with updated baseline after rollback resimulation', function () {
      // Simulates the rollback flow:
      //   1. Simulate frames 0-7 (predict 0)
      //   2. confirmInput(3, 0x01) → misprediction, triggers rollback
      //   3. Rollback resimulation calls getInput(3-8) again
      //      → frame 3 returns confirmed 0x01, updates prediction baseline
      //      → frames 4-8 re-predict as 0x01
      //   4. confirmInput(5, 0x01) → NO misprediction (re-prediction was 0x01)

      const queue = new InputQueue();

      // Initial simulation: frames 0-7 predicted as 0
      for (let f = 0; f <= 7; f++) {
        queue.getInput(f);
      }

      // Remote input arrives for frame 3
      const mis3 = queue.confirmInput(3, 0x01);
      assert.strictEqual(mis3, true, 'frame 3 mispredicted');

      // Rollback resimulation: re-gather inputs for frames 3-7, then advance to 8
      for (let f = 3; f <= 8; f++) {
        const result = queue.getInput(f);
        if (f === 3) {
          assert.strictEqual(result.input, 0x01, 'frame 3 should return confirmed 0x01');
          assert.strictEqual(result.predicted, false, 'frame 3 should be confirmed');
        } else {
          assert.strictEqual(result.input, 0x01, `frame ${f} should re-predict as 0x01`);
          assert.strictEqual(result.predicted, true, `frame ${f} should be predicted`);
        }
      }

      // Now confirm frame 5 with 0x01 — matches the re-prediction, no rollback needed
      const mis5 = queue.confirmInput(5, 0x01);
      assert.strictEqual(mis5, false, 'frame 5: re-prediction was 0x01, confirmed 0x01 → no misprediction');

      // Confirm frame 7 with 0x02 — differs from re-prediction (0x01), misprediction
      const mis7 = queue.confirmInput(7, 0x02);
      assert.strictEqual(mis7, true, 'frame 7: re-prediction was 0x01, confirmed 0x02 → misprediction');
    });

    it('handles multiple rollbacks with different baselines', function () {
      const queue = new InputQueue();

      // Simulate frames 0-10 (predict 0)
      for (let f = 0; f <= 10; f++) {
        queue.getInput(f);
      }

      // Confirm frame 3 with 0x01
      assert.strictEqual(queue.confirmInput(3, 0x01), true);

      // Rollback resimulation from frame 3 to frame 10
      for (let f = 3; f <= 10; f++) {
        queue.getInput(f);
      }

      // Confirm frame 7 with 0x02 — re-prediction was 0x01, so misprediction
      assert.strictEqual(queue.confirmInput(7, 0x02), true);

      // Second rollback resimulation from frame 7 to frame 10
      for (let f = 7; f <= 10; f++) {
        const result = queue.getInput(f);
        if (f === 7) {
          assert.strictEqual(result.input, 0x02, 'frame 7 confirmed as 0x02');
        } else {
          assert.strictEqual(result.input, 0x02, `frame ${f} re-predicts as 0x02`);
        }
      }

      // Confirm frame 9 with 0x02 — matches re-prediction
      assert.strictEqual(queue.confirmInput(9, 0x02), false, 'frame 9 matches re-prediction');
    });

    it('uses correct per-frame baseline when multiple inputs confirmed in one batch', function () {
      // When confirmInput(5, 0x01) and confirmInput(8, 0x02) arrive in the
      // same tick, lastUserInput becomes 0x02. But during rollback resimulation
      // from frame 5, the prediction for frame 6 should use 0x01 (frame 5's
      // confirmed value), not 0x02 (frame 8's). This is achieved by getInput
      // updating lastUserInput when returning confirmed inputs.

      const queue = new InputQueue();

      // Simulate frames 0-10 (predict 0)
      for (let f = 0; f <= 10; f++) {
        queue.getInput(f);
      }

      // Both inputs arrive in the same tick (batch)
      assert.strictEqual(queue.confirmInput(5, 0x01), true, 'frame 5 mispredicted');
      assert.strictEqual(queue.confirmInput(8, 0x02), true, 'frame 8 mispredicted');

      // Rollback resimulation from frame 5 to frame 10
      // getInput(5) returns confirmed 0x01 and updates prediction baseline
      // Frames 6-7 should re-predict as 0x01 (not 0x02!)
      // getInput(8) returns confirmed 0x02 and updates prediction baseline
      // Frames 9-10 should re-predict as 0x02
      for (let f = 5; f <= 10; f++) {
        const result = queue.getInput(f);
        if (f === 5) {
          assert.strictEqual(result.input, 0x01, 'frame 5 confirmed as 0x01');
          assert.strictEqual(result.predicted, false);
        } else if (f <= 7) {
          assert.strictEqual(result.input, 0x01, `frame ${f} should predict 0x01 (based on frame 5)`);
          assert.strictEqual(result.predicted, true);
        } else if (f === 8) {
          assert.strictEqual(result.input, 0x02, 'frame 8 confirmed as 0x02');
          assert.strictEqual(result.predicted, false);
        } else {
          assert.strictEqual(result.input, 0x02, `frame ${f} should predict 0x02 (based on frame 8)`);
          assert.strictEqual(result.predicted, true);
        }
      }

      // Verify consistency regardless of confirmInput arrival order.
      // Reset and re-do with reversed confirm order.
      queue.reset();

      for (let f = 0; f <= 10; f++) {
        queue.getInput(f);
      }

      // Same inputs, reversed arrival order
      assert.strictEqual(queue.confirmInput(8, 0x02), true, 'frame 8 mispredicted');
      assert.strictEqual(queue.confirmInput(5, 0x01), true, 'frame 5 mispredicted');

      // Same rollback resimulation — results should be identical
      for (let f = 5; f <= 10; f++) {
        const result = queue.getInput(f);
        if (f === 5) {
          assert.strictEqual(result.input, 0x01, 'frame 5 confirmed as 0x01');
        } else if (f <= 7) {
          assert.strictEqual(result.input, 0x01, `frame ${f} should predict 0x01 (regardless of confirm order)`);
        } else if (f === 8) {
          assert.strictEqual(result.input, 0x02, 'frame 8 confirmed as 0x02');
        } else {
          assert.strictEqual(result.input, 0x02, `frame ${f} should predict 0x02 (regardless of confirm order)`);
        }
      }
    });
  });

  describe('sequential confirmations', function () {
    it('handles sequential getInput and confirmInput correctly', function () {
      const queue = new InputQueue();

      // Simulate and confirm frame by frame
      const result0 = queue.getInput(0);
      assert.strictEqual(result0.input, 0);
      assert.strictEqual(result0.predicted, true);

      const mis0 = queue.confirmInput(0, 0x02);
      assert.strictEqual(mis0, true, 'frame 0 mispredicted');

      // Now lastUserInput should be 0x02, so prediction for frame 1 is 0x02
      const result1 = queue.getInput(1);
      assert.strictEqual(result1.input, 0x02, 'frame 1 should predict 0x02');
      assert.strictEqual(result1.predicted, true);

      const mis1 = queue.confirmInput(1, 0x02);
      assert.strictEqual(mis1, false, 'frame 1 prediction was correct');

      // Confirm frame 2 with different input
      const result2 = queue.getInput(2);
      assert.strictEqual(result2.input, 0x02, 'frame 2 should predict 0x02');

      const mis2 = queue.confirmInput(2, 0x04);
      assert.strictEqual(mis2, true, 'frame 2 mispredicted');
    });
  });

  describe('getInput writes predictions to ring buffer', function () {
    it('stores prediction in ring buffer so re-read returns same value', function () {
      const queue = new InputQueue();

      // First read — prediction
      const first = queue.getInput(0);
      assert.strictEqual(first.input, 0);
      assert.strictEqual(first.predicted, true);

      // Second read — should return the stored prediction (re-predicted, same value)
      const second = queue.getInput(0);
      assert.strictEqual(second.input, 0);
      assert.strictEqual(second.predicted, true);
    });

    it('advances lastAddedFrame when predicting', function () {
      const queue = new InputQueue();
      assert.strictEqual(queue.lastAddedFrame, -1);

      queue.getInput(5);
      assert.strictEqual(queue.lastAddedFrame, 5);

      // Frames 0-5 should all be filled
      for (let f = 0; f <= 5; f++) {
        const result = queue.getInput(f);
        assert.strictEqual(result.input, 0, `frame ${f} should be 0`);
        assert.strictEqual(result.predicted, true, `frame ${f} should be predicted`);
      }
    });
  });
});
