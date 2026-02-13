// Keyboard + gamepad input sampling for game controls
// Uses Babylon's scene.onKeyboardObservable for input tied to scene lifecycle.
// Output: { left, right, flap, escape } booleans
// Flap and escape use edge detection — returns true only on the frame the key
// transitions from released to pressed (one event per press).
// "Any key = flap" — any key that isn't a movement key or Escape triggers flap.
// Gamepad: D-pad/analog for movement, any face/shoulder button for flap.

import { KeyboardEventTypes } from '@babylonjs/core/Events/keyboardEvents';

// Keys that are NOT flap
const MOVEMENT_KEYS = new Set([
  'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight',
]);
const IGNORED_KEYS = new Set([
  'Escape', 'Tab', 'CapsLock', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'ContextMenu',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

const GAMEPAD_DEADZONE = 0.3;

export class InputReader {
  constructor() {
    this.keys = {};
    this._flapConsumed = true;
    this._escapeConsumed = true;
    this._scene = null;
    this._observer = null;
    this.attached = false;

    // Gamepad
    this._gamepadIndex = null;
    this._gamepadConnectHandler = null;
    this._gamepadDisconnectHandler = null;
    this._prevGamepadButtons = [];
  }

  attach(scene) {
    if (this.attached) {
      return;
    }

    this._scene = scene;
    this._observer = scene.onKeyboardObservable.add((kbInfo) => {
      const code = kbInfo.event.code;

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        // Edge detection for escape
        if (code === 'Escape') {
          if (!this.keys[code]) {
            this._escapeConsumed = false;
          }
        }
        // Any non-movement, non-ignored key = flap (edge detection)
        if (!MOVEMENT_KEYS.has(code) && !IGNORED_KEYS.has(code)) {
          if (!this.keys[code]) {
            this._flapConsumed = false;
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

    // Gamepad connection tracking
    this._gamepadConnectHandler = (e) => {
      if (this._gamepadIndex === null) {
        this._gamepadIndex = e.gamepad.index;
      }
    };
    this._gamepadDisconnectHandler = (e) => {
      if (e.gamepad.index === this._gamepadIndex) {
        this._gamepadIndex = null;
      }
    };
    window.addEventListener('gamepadconnected', this._gamepadConnectHandler);
    window.addEventListener('gamepaddisconnected', this._gamepadDisconnectHandler);

    // Check if a gamepad is already connected
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (gp) {
        this._gamepadIndex = gp.index;
        break;
      }
    }

    this.attached = true;
  }

  detach() {
    if (this._scene && this._observer) {
      this._scene.onKeyboardObservable.remove(this._observer);
    }
    if (this._gamepadConnectHandler) {
      window.removeEventListener('gamepadconnected', this._gamepadConnectHandler);
      window.removeEventListener('gamepaddisconnected', this._gamepadDisconnectHandler);
    }
    this._scene = null;
    this._observer = null;
    this.keys = {};
    this._flapConsumed = true;
    this._escapeConsumed = true;
    this._gamepadIndex = null;
    this._gamepadConnectHandler = null;
    this._gamepadDisconnectHandler = null;
    this._prevGamepadButtons = [];
    this.attached = false;
  }

  _sampleGamepad() {
    const result = { left: false, right: false, flap: false };

    if (this._gamepadIndex === null) {
      return result;
    }

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this._gamepadIndex];
    if (!gp) {
      return result;
    }

    // Left analog stick (axis 0) or right analog stick (axis 2)
    const leftX = gp.axes[0] || 0;
    const rightX = gp.axes.length > 2 ? (gp.axes[2] || 0) : 0;
    const axisX = Math.abs(leftX) > Math.abs(rightX) ? leftX : rightX;

    if (axisX < -GAMEPAD_DEADZONE) {
      result.left = true;
    } else if (axisX > GAMEPAD_DEADZONE) {
      result.right = true;
    }

    // D-pad (buttons 12=up, 13=down, 14=left, 15=right on standard mapping)
    if (gp.buttons[14] && gp.buttons[14].pressed) {
      result.left = true;
    }
    if (gp.buttons[15] && gp.buttons[15].pressed) {
      result.right = true;
    }

    // Any face button (0-3: A/B/X/Y) or shoulder/trigger (4-7) = flap (edge detection)
    const flapButtons = [0, 1, 2, 3, 4, 5, 6, 7];
    for (const idx of flapButtons) {
      if (gp.buttons[idx] && gp.buttons[idx].pressed) {
        if (!this._prevGamepadButtons[idx]) {
          result.flap = true;
        }
      }
    }

    // Store button state for edge detection next frame
    this._prevGamepadButtons = gp.buttons.map(b => b.pressed);

    return result;
  }

  sample() {
    const flapPressed = !this._flapConsumed;
    if (flapPressed) {
      this._flapConsumed = true;
    }

    const escapePressed = !this._escapeConsumed;
    if (escapePressed) {
      this._escapeConsumed = true;
    }

    // Gamepad input
    const gp = this._sampleGamepad();

    return {
      left: this.keys['ArrowLeft'] || this.keys['KeyA'] || gp.left || false,
      right: this.keys['ArrowRight'] || this.keys['KeyD'] || gp.right || false,
      flap: flapPressed || gp.flap,
      escape: escapePressed,
    };
  }
}
