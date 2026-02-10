// Keyboard input sampling for game controls
// Samples the current state of input keys each tick
// Output: { left, right, flap } booleans

export class InputReader {
  constructor() {
    this.keys = {};
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this.attached = false;
  }

  // Attach keyboard listeners to the window
  attach() {
    if (this.attached) {
      return;
    }

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.attached = true;
  }

  // Remove keyboard listeners
  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.keys = {};
    this.attached = false;
  }

  // Sample the current input state as a structured object
  sample() {
    return {
      left: this.keys['ArrowLeft'] || this.keys['KeyA'] || false,
      right: this.keys['ArrowRight'] || this.keys['KeyD'] || false,
      flap: this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW'] || false,
    };
  }

  // --- Private ---

  _onKeyDown(event) {
    this.keys[event.code] = true;

    // Prevent scrolling for game keys
    if (event.code === 'Space' || event.code === 'ArrowUp' ||
        event.code === 'ArrowDown' || event.code === 'ArrowLeft' ||
        event.code === 'ArrowRight') {
      event.preventDefault();
    }
  }

  _onKeyUp(event) {
    this.keys[event.code] = false;
  }
}
