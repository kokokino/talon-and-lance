// BabylonPage — Mithril component that creates the canvas and boots the Babylon scene
// Rendered for authenticated users at the '/' route

import m from 'mithril';
import { MainMenuScene } from '../../game/scenes/MainMenuScene.js';

export const BabylonPage = {
  oninit() {
    this.menuScene = null;
  },

  oncreate(vnode) {
    const canvas = vnode.dom;

    // Set body class for full-viewport black background
    document.body.classList.add('babylon-active');

    // Boot the Babylon scene
    this.menuScene = new MainMenuScene();
    this.menuScene.create(canvas);
  },

  onremove() {
    if (this.menuScene) {
      this.menuScene.dispose();
      this.menuScene = null;
    }

    document.body.classList.remove('babylon-active');
  },

  view() {
    return m('canvas#renderCanvas', {
      'touch-action': 'none',
    });
  },
};
