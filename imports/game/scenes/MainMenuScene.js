// MainMenuScene — full menu scene with voxel knight+ostrich on stone platforms
// over animated lava, with three menu buttons

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Button } from '@babylonjs/gui/2D/controls/button';
import { StackPanel } from '@babylonjs/gui/2D/controls/stackPanel';
import { Control } from '@babylonjs/gui/2D/controls/control';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { Meteor } from 'meteor/meteor';

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { buildRig } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';

const ASPECT = 16 / 9;
const VOXEL_SIZE = 0.18;

export class MainMenuScene {
  constructor() {
    this.engine = null;
    this.scene = null;
    this.canvas = null;
    this.elapsed = 0;

    // Rig references for animation
    this.knightRig = null;
    this.lanceRig = null;
    this.ostrichRig = null;

    // Shoulder pivot nodes for arm rotation
    this.leftShoulderNode = null;
    this.rightShoulderNode = null;

    // Lava references
    this.lavaMaterial = null;
    this.lavaUvOffset = 0;

    // Resize handler reference for cleanup
    this._resizeHandler = null;
  }

  /**
   * Initialize engine, scene, all objects, and start render loop.
   * @param {HTMLCanvasElement} canvas
   */
  create(canvas) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.12, 0.10, 0.10, 1); // Deep charcoal

    this._setupCamera();
    this._setupLighting();
    this._createLava();
    this._createPlatforms();
    this._createCharacters();
    this._createMenuButtons();

    // Animation callback
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this._updateAnimations(dt);
    });

    // Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // Resize handling
    this._resizeHandler = () => {
      this._resizeCanvas();
    };
    window.addEventListener('resize', this._resizeHandler);
    this._resizeCanvas();
  }

  /**
   * Stop render loop, dispose engine, clean up.
   */
  dispose() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.engine.dispose();
      this.engine = null;
    }
    this.scene = null;
  }

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
      // Window is wider than 16:9 — letterbox sides
      h = windowH;
      w = Math.floor(h * ASPECT);
    } else {
      // Window is taller than 16:9 — letterbox top/bottom
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
  }

  // ---- Setup methods ----

  _setupCamera() {
    const camera = new ArcRotateCamera(
      'menuCamera',
      -Math.PI / 2.5,  // alpha — horizontal angle
      Math.PI / 3.0,    // beta — vertical angle (looking slightly down)
      6,                 // radius — close enough to frame characters well
      new Vector3(-0.1, 0.5, 0), // target — centered on characters
      this.scene
    );
    // Lock radius and vertical angle, allow horizontal orbit
    camera.lowerRadiusLimit = camera.radius;
    camera.upperRadiusLimit = camera.radius;
    camera.lowerBetaLimit = Math.PI / 4;    // Don't look too far up
    camera.upperBetaLimit = Math.PI / 2.2;  // Don't look too far down
    camera.attachControl(this.canvas, true);

    // Slow auto-rotation — pauses when user is dragging
    camera.useAutoRotationBehavior = true;
    camera.autoRotationBehavior.idleRotationSpeed = 0.08;
    camera.autoRotationBehavior.idleRotationWaitTime = 2000;
    camera.autoRotationBehavior.idleRotationSpinupTime = 1000;
    camera.autoRotationBehavior.zoomStopsAnimation = false;

    this.camera = camera;
  }

  _setupLighting() {
    // Soft ambient fill (slightly warm)
    const ambient = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.5;
    ambient.diffuse = new Color3(1.0, 0.95, 0.9);
    ambient.groundColor = new Color3(0.3, 0.2, 0.15);

    // Main directional light from upper-left
    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, 1), this.scene);
    dirLight.intensity = 0.7;
    dirLight.diffuse = new Color3(1.0, 0.95, 0.85);

    // Lava glow from below
    const lavaLight = new PointLight('lavaLight', new Vector3(0, -1.5, 0), this.scene);
    lavaLight.intensity = 0.6;
    lavaLight.diffuse = new Color3(1.0, 0.4, 0.1);
    lavaLight.range = 12;
  }

  _createLava() {
    const lava = MeshBuilder.CreateGround('lava', { width: 20, height: 20 }, this.scene);
    lava.position.y = -2.5;

    // Generate a procedural lava texture
    const lavaTexture = new DynamicTexture('lavaTex', 256, this.scene, false);
    const ctx = lavaTexture.getContext();
    this._drawLavaPattern(ctx, 256);
    lavaTexture.update();
    lavaTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    lavaTexture.wrapV = Texture.WRAP_ADDRESSMODE;

    const lavaMat = new StandardMaterial('lavaMat', this.scene);
    lavaMat.diffuseTexture = lavaTexture;
    lavaMat.emissiveColor = new Color3(0.8, 0.25, 0.05);
    lavaMat.specularColor = new Color3(0, 0, 0);
    lavaMat.backFaceCulling = true;
    lava.material = lavaMat;

    this.lavaMaterial = lavaMat;
    this.lavaTexture = lavaTexture;
  }

  /**
   * Draw a procedural red-orange-yellow gradient lava pattern on a canvas context.
   */
  _drawLavaPattern(ctx, size) {
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        // Simple pseudo-noise using sine combinations
        const nx = x / size;
        const ny = y / size;
        const noise = (
          Math.sin(nx * 12.0 + ny * 8.0) * 0.3 +
          Math.sin(nx * 5.0 - ny * 15.0) * 0.2 +
          Math.sin((nx + ny) * 20.0) * 0.15 +
          0.5
        );
        const clamped = Math.max(0, Math.min(1, noise));

        // Map noise to lava colors: dark red → orange → bright yellow
        data[idx] = Math.floor(120 + clamped * 135);      // R: 120-255
        data[idx + 1] = Math.floor(20 + clamped * 120);   // G: 20-140
        data[idx + 2] = Math.floor(5 + clamped * 25);     // B: 5-30
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _createPlatforms() {
    // Main platform — where knight and ostrich stand
    const mainPlatform = this._createStonePlatform('mainPlatform', 4, 0.4, 2.5);
    mainPlatform.position = new Vector3(-0.3, -1.0, 0);

    // Background platform (left, higher)
    const bgPlatform1 = this._createStonePlatform('bgPlatform1', 1.8, 0.35, 1.5);
    bgPlatform1.position = new Vector3(-3.5, -0.5, -2);

    // Background platform (right, lower)
    const bgPlatform2 = this._createStonePlatform('bgPlatform2', 1.5, 0.3, 1.2);
    bgPlatform2.position = new Vector3(3, -1.5, -1.5);
  }

  _createStonePlatform(name, width, height, depth) {
    const platform = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    const mat = new StandardMaterial(`${name}Mat`, this.scene);
    mat.diffuseColor = new Color3(0.45, 0.40, 0.35);  // Gray-brown stone
    mat.specularColor = new Color3(0.1, 0.1, 0.1);

    // Darker edge tint via emissive
    mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
    platform.material = mat;
    return platform;
  }

  _createCharacters() {
    // Build ostrich rig — position so feet rest on platform
    // Legs grew by 3 voxels, raise Y by 3 * 0.18 = 0.54
    this.ostrichRig = buildRig(this.scene, ostrichModel, VOXEL_SIZE);
    if (this.ostrichRig.root) {
      this.ostrichRig.root.position = new Vector3(0.5, 0.49, 0);
      this.ostrichRig.root.rotation.y = -0.3; // Face slightly toward camera
    }

    // Build knight rig — position to the left of ostrich, facing camera
    this.knightRig = buildRig(this.scene, knightModel, VOXEL_SIZE);
    if (this.knightRig.root) {
      this.knightRig.root.position = new Vector3(-1.6, 0.29, 0.7);
      this.knightRig.root.rotation.y = -0.3; // Rotate front toward camera, lance away from ostrich
    }

    // Create shoulder pivot nodes so arms rotate forward from the shoulder joint
    const parts = this.knightRig.parts;
    if (parts.leftArm && parts.torso) {
      this.leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      this.leftShoulderNode.parent = parts.torso.mesh;
      this.leftShoulderNode.position = new Vector3(
        -3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      parts.leftArm.mesh.parent = this.leftShoulderNode;
      parts.leftArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this.leftShoulderNode.rotation.x = Math.PI / 2; // Point arm forward
      // Rotate shield so its face points forward (compensate for arm rotation)
      if (parts.shield) {
        parts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (parts.rightArm && parts.torso) {
      this.rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      this.rightShoulderNode.parent = parts.torso.mesh;
      this.rightShoulderNode.position = new Vector3(
        3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      parts.rightArm.mesh.parent = this.rightShoulderNode;
      parts.rightArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this.rightShoulderNode.rotation.x = Math.PI / 2; // Point arm forward
    }

    // Build lance (single part rig) — held in right hand, pointed skyward
    this.lanceRig = buildRig(this.scene, lanceModel, VOXEL_SIZE);
    if (this.lanceRig.root && parts.rightArm) {
      this.lanceRig.root.parent = parts.rightArm.mesh;
      this.lanceRig.root.position = new Vector3(0, 0, 0);
      this.lanceRig.root.rotation.x = Math.PI; // Flip so tip extends forward along arm
    }
  }

  _createMenuButtons() {
    // Percentage-based GUI like the Babylon playground — scales cleanly
    const gui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI');
    gui.idealWidth = 1280;
    gui.renderScale = window.devicePixelRatio || 1;

    // Prevent post-processing from blurring the GUI layer
    if (gui.layer) {
      gui.layer.applyPostProcess = false;
    }

    // Semi-transparent backdrop behind button stack
    const backdrop = new Rectangle('menuBackdrop');
    backdrop.widthInPixels = 240;
    backdrop.heightInPixels = 210;
    backdrop.cornerRadius = 10;
    backdrop.thickness = 0;
    backdrop.background = 'rgba(0, 0, 0, 0.5)';
    backdrop.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    backdrop.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    backdrop.left = '-40px';
    gui.addControl(backdrop);

    // Stack panel on the right side
    const panel = new StackPanel('menuPanel');
    panel.widthInPixels = 220;
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    panel.left = '-50px';
    panel.spacing = 10;
    gui.addControl(panel);

    // Hub button — functional
    const hubBtn = this._createMenuButton('Hub', false);
    hubBtn.onPointerClickObservable.add(() => {
      const hubUrl = Meteor.settings.public?.hubUrl;
      if (hubUrl) {
        window.location.href = hubUrl;
      }
    });
    panel.addControl(hubBtn);

    // Team Play — disabled
    const teamBtn = this._createMenuButton('Team Play', true);
    panel.addControl(teamBtn);

    // Player vs Player — disabled
    const pvpBtn = this._createMenuButton('PvP Arena', true);
    panel.addControl(pvpBtn);
  }

  _createMenuButton(label, disabled) {
    // Use built-in label (2nd param) — playground style
    const btn = Button.CreateSimpleButton(`btn_${label}`, label);
    btn.widthInPixels = 200;
    btn.heightInPixels = 55;
    btn.cornerRadius = 14;
    btn.fontSize = 26;
    btn.fontFamily = 'monospace';

    if (disabled) {
      btn.background = '#2A2724';
      btn.color = '#9A9590';
      btn.thickness = 1;
      btn.hoverCursor = 'default';

      btn.onPointerEnterObservable.add(() => {
        btn.textBlock.text = 'Coming Soon';
        btn.background = '#352F2C';
      });
      btn.onPointerOutObservable.add(() => {
        btn.textBlock.text = label;
        btn.background = '#2A2724';
      });
    } else {
      btn.background = '#2A2520';
      btn.color = '#FFD740';
      btn.thickness = 2;

      btn.onPointerEnterObservable.add(() => {
        btn.background = '#3A3530';
        btn.color = '#FFF176';
      });
      btn.onPointerOutObservable.add(() => {
        btn.background = '#2A2520';
        btn.color = '#FFD740';
      });
    }

    return btn;
  }

  // ---- Animation ----

  _updateAnimations(dt) {
    this.elapsed += dt;
    this._animateKnight();
    this._animateOstrich();
    this._animateLava(dt);
  }

  _animateKnight() {
    const t = this.elapsed;
    const parts = this.knightRig?.parts;
    if (!parts) {
      return;
    }

    // Torso: gentle breathing bob — Y oscillates ±0.02, period ~3s
    if (parts.torso) {
      parts.torso.mesh.position.y = Math.sin(t * (2 * Math.PI / 3)) * 0.02;
    }

    // Head: slight independent nod — rotation.x ±0.03 rad, period ~4s
    if (parts.head) {
      parts.head.mesh.rotation.x = Math.sin(t * (2 * Math.PI / 4)) * 0.03;
    }

    // Arms: subtle sway via shoulder joints — rotation.z ±0.02 rad, period ~3.5s
    if (this.leftShoulderNode) {
      this.leftShoulderNode.rotation.z = Math.sin(t * (2 * Math.PI / 3.5)) * 0.02;
    }
    if (this.rightShoulderNode) {
      this.rightShoulderNode.rotation.z = Math.sin(t * (2 * Math.PI / 3.5) + 0.5) * 0.02;
    }
  }

  _animateOstrich() {
    const t = this.elapsed;
    const parts = this.ostrichRig?.parts;
    if (!parts) {
      return;
    }

    // Body: weight shift — tilts rotation.z ±0.015 rad, period ~5s
    if (parts.body) {
      parts.body.mesh.rotation.z = Math.sin(t * (2 * Math.PI / 5)) * 0.015;
    }

    // Neck+Head: bob up/down (rotation.x ±0.08, period ~2s) + look left/right (rotation.y ±0.15, period ~6s)
    if (parts.neck) {
      parts.neck.mesh.rotation.x = Math.sin(t * (2 * Math.PI / 2)) * 0.08;
      parts.neck.mesh.rotation.y = Math.sin(t * (2 * Math.PI / 6)) * 0.15;
    }

    // Wings: resting with periodic ruffle every ~8s
    const wingCycle = t % 8;
    let wingFlare = 0;
    if (wingCycle > 7.0 && wingCycle < 7.5) {
      // Flare out over 0.5s
      const ruffleT = (wingCycle - 7.0) / 0.5;
      wingFlare = Math.sin(ruffleT * Math.PI) * 0.3;
    }
    if (parts.leftWing) {
      parts.leftWing.mesh.rotation.z = -wingFlare;
    }
    if (parts.rightWing) {
      parts.rightWing.mesh.rotation.z = wingFlare;
    }

    // Legs: alternate subtle bend synced with body weight shift
    const legBend = Math.sin(t * (2 * Math.PI / 5)) * 0.03;
    if (parts.leftLeg) {
      parts.leftLeg.mesh.rotation.x = legBend;
    }
    if (parts.rightLeg) {
      parts.rightLeg.mesh.rotation.x = -legBend;
    }
  }

  _animateLava(dt) {
    if (!this.lavaMaterial) {
      return;
    }

    // Emissive intensity pulse: sine wave, period ~4s
    const pulse = 0.6 + Math.sin(this.elapsed * (2 * Math.PI / 4)) * 0.2;
    this.lavaMaterial.emissiveColor = new Color3(pulse, pulse * 0.3, pulse * 0.06);

    // UV scroll: constant slow drift
    if (this.lavaMaterial.diffuseTexture) {
      this.lavaUvOffset += dt * 0.02;
      this.lavaMaterial.diffuseTexture.uOffset = this.lavaUvOffset;
      this.lavaMaterial.diffuseTexture.vOffset = this.lavaUvOffset * 0.7;
    }
  }
}
