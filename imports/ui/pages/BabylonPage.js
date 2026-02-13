// BabylonPage — Mithril component that owns the Babylon Engine, render loop,
// canvas resize, and AudioManager. Orchestrates scene transitions.

import m from 'mithril';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { AudioManager } from '../../game/audio/AudioManager.js';
import { MainMenuScene } from '../../game/scenes/MainMenuScene.js';
import { Level1Scene } from '../../game/scenes/Level1Scene.js';

const ASPECT = 16 / 9;

export const BabylonPage = {
  oninit() {
    this.engine = null;
    this.scene = null;
    this.canvas = null;
    this.audioManager = null;
    this._currentScene = null;
    this._resizeHandler = null;
    this._paletteIndex = parseInt(localStorage.getItem('talon-lance:paletteIndex'), 10) || 0;
  },

  oncreate(vnode) {
    this.canvas = vnode.dom;
    document.body.classList.add('babylon-active');

    // Create Engine
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });

    // Start render loop (renders whichever Scene is active)
    this.engine.runRenderLoop(() => {
      if (this.scene) {
        this.scene.render();
      }
    });

    // Resize handling
    this._resizeHandler = () => {
      this._resizeCanvas();
    };
    window.addEventListener('resize', this._resizeHandler);
    this._resizeCanvas();

    // Boot AudioManager then show main menu
    this.audioManager = new AudioManager();
    this._bootMainMenu();
  },

  onremove() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._currentScene) {
      this._currentScene.dispose();
      this._currentScene = null;
    }
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
    if (this.audioManager) {
      this.audioManager.dispose();
      this.audioManager = null;
    }
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.engine.dispose();
      this.engine = null;
    }
    document.body.classList.remove('babylon-active');
  },

  view() {
    return m('canvas#renderCanvas', {
      'touch-action': 'none',
    });
  },

  // ---- Internal methods ----

  async _bootMainMenu() {
    await this.audioManager.init();
    this._transitionTo(new MainMenuScene({
      audioManager: this.audioManager,
      paletteIndex: this._paletteIndex,
      onPlay: (paletteIndex) => {
        this._paletteIndex = paletteIndex;
        this._startLevel(paletteIndex);
      },
    }));
  },

  /**
   * Transition to a new scene instance. Disposes old scene content,
   * creates a fresh Babylon Scene on the same Engine, and calls
   * sceneInstance.create(scene, engine, canvas).
   * @param {Object} sceneInstance — must have create(scene, engine, canvas) and dispose()
   */
  _startLevel(paletteIndex) {
    this._transitionTo(new Level1Scene({
      audioManager: this.audioManager,
      paletteIndex,
      onQuitToMenu: () => {
        this._bootMainMenu();
      },
    }));
  },

  _transitionTo(sceneInstance) {
    // Dispose old scene content
    if (this._currentScene) {
      this._currentScene.dispose();
      this._currentScene = null;
    }

    // Dispose old Babylon Scene
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }

    // Create fresh Babylon Scene on same Engine
    this.scene = new Scene(this.engine);
    this._currentScene = sceneInstance;
    sceneInstance.create(this.scene, this.engine, this.canvas);
  },

  /**
   * Resize canvas to maintain 16:9 aspect ratio with letterboxing.
   */
  _resizeCanvas() {
    if (!this.canvas || !this.engine) {
      return;
    }

    const windowW = window.innerWidth;
    const windowH = window.innerHeight;
    let w, h;

    if (windowW / windowH > ASPECT) {
      h = windowH;
      w = Math.floor(h * ASPECT);
    } else {
      w = windowW;
      h = Math.floor(w / ASPECT);
    }

    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.style.marginLeft = Math.floor((windowW - w) / 2) + 'px';
    this.canvas.style.marginTop = Math.floor((windowH - h) / 2) + 'px';
    this.engine.resize();
  },
};
