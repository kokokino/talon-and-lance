// Keyboard input sampling for game controls
// Uses Babylon's scene.onKeyboardObservable for input tied to scene lifecycle.
// Output: { left, right, flap, switchChar, cycleType } booleans
// Flap, switchChar, and cycleType use edge detection — returns true only on the
// frame the key transitions from released to pressed (one event per press).

import { KeyboardEventTypes } from '@babylonjs/core/Events/keyboardEvents';

export class InputReader {
  constructor() {
    this.keys = {};
    this._flapConsumed = true;
    this._switchCharConsumed = true;
    this._cycleTypeConsumed = true;
    this._scene = null;
    this._observer = null;
    this.attached = false;
  }

  // Attach to a Babylon scene's keyboard observable
  attach(scene) {
    if (this.attached) {
      return;
    }

    this._scene = scene;
    this._observer = scene.onKeyboardObservable.add((kbInfo) => {
      const code = kbInfo.event.code;

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        // Edge detection for flap: only trigger on fresh press
        if (code === 'Space' || code === 'KeyW') {
          if (!this.keys[code]) {
            this._flapConsumed = false;
          }
        }
        // Edge detection for switchChar (ArrowUp)
        if (code === 'ArrowUp') {
          if (!this.keys[code]) {
            this._switchCharConsumed = false;
          }
        }
        // Edge detection for cycleType (ArrowDown)
        if (code === 'ArrowDown') {
          if (!this.keys[code]) {
            this._cycleTypeConsumed = false;
          }
        }
        this.keys[code] = true;

        // Prevent scrolling for game keys
        if (code === 'Space' || code === 'ArrowUp' ||
            code === 'ArrowDown' || code === 'ArrowLeft' ||
            code === 'ArrowRight') {
          kbInfo.event.preventDefault();
        }
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        this.keys[code] = false;
      }
    });

    this.attached = true;
  }

  // Remove keyboard observer
  detach() {
    if (this._scene && this._observer) {
      this._scene.onKeyboardObservable.remove(this._observer);
    }
    this._scene = null;
    this._observer = null;
    this.keys = {};
    this._flapConsumed = true;
    this._switchCharConsumed = true;
    this._cycleTypeConsumed = true;
    this.attached = false;
  }

  // Sample the current input state as a structured object
  sample() {
    const flapPressed = !this._flapConsumed;
    if (flapPressed) {
      this._flapConsumed = true;
    }

    const switchCharPressed = !this._switchCharConsumed;
    if (switchCharPressed) {
      this._switchCharConsumed = true;
    }

    const cycleTypePressed = !this._cycleTypeConsumed;
    if (cycleTypePressed) {
      this._cycleTypeConsumed = true;
    }

    return {
      left: this.keys['ArrowLeft'] || this.keys['KeyA'] || false,
      right: this.keys['ArrowRight'] || this.keys['KeyD'] || false,
      flap: flapPressed,
      switchChar: switchCharPressed,
      cycleType: cycleTypePressed,
    };
  }
}
