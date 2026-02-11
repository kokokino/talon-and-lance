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
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { StackPanel } from '@babylonjs/gui/2D/controls/stackPanel';
import { Control } from '@babylonjs/gui/2D/controls/control';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Meteor } from 'meteor/meteor';

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { buildRig } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { KNIGHT_PALETTES, buildKnightPalette } from '../voxels/models/knightPalettes.js';

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

    // Menu state machine
    this._menuState = 'main';   // 'main' | 'modeSelect'
    this._selectedMode = null;  // 'team' | 'pvp'
    this._paletteIndex = 0;

    // GUI references
    this._gui = null;
    this._mainBackdrop = null;
    this._mainPanel = null;
    this._modeBackdrop = null;
    this._modePanel = null;
    this._colorLabel = null;
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
      new Vector3(-0.1, 1.0, 0), // target — raised to keep ostrich head in frame
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

    // Lava burst particle effects
    this._createLavaBursts(lava);
  }

  _createLavaBursts(lavaMesh) {
    this._lavaBurstTimer = 0;
  }

  /**
   * Spawn a single lava burst at a random position on the lava surface.
   */
  _spawnLavaBurst() {
    // Create a fresh particle texture per burst (shared textures get
    // invalidated when disposeOnStop disposes the particle system)
    const tex = new DynamicTexture('lavaBurstTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 200, 50, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 100, 20, 0.8)');
    gradient.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('lavaBurst', 30, this.scene);
    ps.particleTexture = tex;

    // Spawn anywhere on the visible lava field, but not under platforms
    const platforms = [
      { xMin: -2.8, xMax: 2.2, zMin: -1.8, zMax: 1.8 },   // Main platform (with margin)
      { xMin: -4.9, xMax: -2.1, zMin: -3.3, zMax: -0.7 },  // Left BG platform (with margin)
      { xMin: 1.7, xMax: 4.3, zMin: -2.6, zMax: -0.4 },    // Right BG platform (with margin)
    ];
    let x, z;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 18;
      z = (Math.random() - 0.5) * 18;
      attempts++;
    } while (
      attempts < 20 &&
      platforms.some(p => x >= p.xMin && x <= p.xMax && z >= p.zMin && z <= p.zMax)
    );
    ps.emitter = new Vector3(x, -2.3, z);

    // Particles shoot upward
    ps.direction1 = new Vector3(-0.5, 4, -0.5);
    ps.direction2 = new Vector3(0.5, 8, 0.5);
    ps.gravity = new Vector3(0, -6, 0);

    // Size
    ps.minSize = 0.12;
    ps.maxSize = 0.35;

    // Lifetime
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;

    // Emission — short burst
    ps.emitRate = 40;
    ps.manualEmitCount = 12 + Math.floor(Math.random() * 10);

    // Colors: bright yellow → orange → dark red
    ps.color1 = new Color4(1.0, 0.8, 0.2, 1);
    ps.color2 = new Color4(1.0, 0.4, 0.1, 1);
    ps.colorDead = new Color4(0.5, 0.1, 0.0, 0);

    // Blending
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 0.15;
    ps.disposeOnStop = true;
    ps.start();
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
    this.ostrichRig = buildRig(this.scene, ostrichModel, VOXEL_SIZE);
    if (this.ostrichRig.root) {
      this.ostrichRig.root.position = new Vector3(0.5, 0.49, 0);
      this.ostrichRig.root.rotation.y = -0.3; // Face slightly toward camera
    }

    // Build knight + lance with current palette
    this._buildKnight(this._paletteIndex);
  }

  /**
   * Dispose and rebuild the knight + lance rigs with a new palette.
   * Animation picks up new meshes automatically via this.knightRig.parts.
   * @param {number} paletteIndex — 0–3
   */
  _buildKnight(paletteIndex) {
    // --- Dispose existing lance ---
    if (this.lanceRig) {
      for (const part of Object.values(this.lanceRig.parts)) {
        if (part.mesh) {
          if (part.mesh.material) {
            part.mesh.material.dispose();
          }
          part.mesh.dispose();
        }
      }
      this.lanceRig = null;
    }

    // --- Dispose shoulder transform nodes ---
    if (this.leftShoulderNode) {
      this.leftShoulderNode.dispose();
      this.leftShoulderNode = null;
    }
    if (this.rightShoulderNode) {
      this.rightShoulderNode.dispose();
      this.rightShoulderNode = null;
    }

    // --- Dispose existing knight ---
    if (this.knightRig) {
      for (const part of Object.values(this.knightRig.parts)) {
        if (part.mesh) {
          if (part.mesh.material) {
            part.mesh.material.dispose();
          }
          part.mesh.dispose();
        }
      }
      this.knightRig = null;
    }

    // --- Build knight rig with merged palette ---
    const mergedPalette = buildKnightPalette(paletteIndex);
    this.knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VOXEL_SIZE);
    if (this.knightRig.root) {
      this.knightRig.root.position = new Vector3(-1.6, 0.29, 0.7);
      this.knightRig.root.rotation.y = -0.3;
    }

    // --- Create shoulder pivot nodes ---
    const parts = this.knightRig.parts;
    if (parts.leftArm && parts.torso) {
      this.leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      this.leftShoulderNode.parent = parts.torso.mesh;
      this.leftShoulderNode.position = new Vector3(
        3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      parts.leftArm.mesh.parent = this.leftShoulderNode;
      parts.leftArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this.leftShoulderNode.rotation.x = Math.PI / 2;
      if (parts.shield) {
        parts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (parts.rightArm && parts.torso) {
      this.rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      this.rightShoulderNode.parent = parts.torso.mesh;
      this.rightShoulderNode.position = new Vector3(
        -3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      parts.rightArm.mesh.parent = this.rightShoulderNode;
      parts.rightArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this.rightShoulderNode.rotation.x = Math.PI / 2;
    }

    // --- Build lance, parent to right arm ---
    this.lanceRig = buildRig(this.scene, lanceModel, VOXEL_SIZE);
    if (this.lanceRig.root && parts.rightArm) {
      this.lanceRig.root.parent = parts.rightArm.mesh;
      this.lanceRig.root.position = new Vector3(0, 0, 0);
      this.lanceRig.root.rotation.x = Math.PI;
    }
  }

  _createMenuButtons() {
    const gui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI');
    gui.idealWidth = 1280;
    gui.renderScale = 2;

    if (gui.layer) {
      gui.layer.applyPostProcess = false;
    }

    this._gui = gui;
    this._createMainPanel(gui);
    this._createModeSelectPanel(gui);
    this._showMainMenu();
  }

  // ---- Main menu panel ----

  _createMainPanel(gui) {
    const backdrop = new Rectangle('mainBackdrop');
    backdrop.widthInPixels = 240;
    backdrop.heightInPixels = 210;
    backdrop.cornerRadius = 10;
    backdrop.thickness = 0;
    backdrop.background = 'rgba(0, 0, 0, 0.5)';
    backdrop.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    backdrop.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    backdrop.left = '-40px';
    gui.addControl(backdrop);
    this._mainBackdrop = backdrop;

    const panel = new StackPanel('mainPanel');
    panel.widthInPixels = 220;
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    panel.left = '-50px';
    panel.spacing = 10;
    gui.addControl(panel);
    this._mainPanel = panel;

    // Hub button
    const hubBtn = this._createMenuButton('Hub', false);
    hubBtn.onPointerClickObservable.add(() => {
      const hubUrl = Meteor.settings.public?.hubUrl;
      if (hubUrl) {
        window.location.href = hubUrl;
      }
    });
    panel.addControl(hubBtn);

    // Team Play — opens mode select
    const teamBtn = this._createMenuButton('Team Play', false);
    teamBtn.onPointerClickObservable.add(() => {
      this._selectedMode = 'team';
      this._showModeSelect();
    });
    panel.addControl(teamBtn);

    // PvP Arena — opens mode select
    const pvpBtn = this._createMenuButton('PvP Arena', false);
    pvpBtn.onPointerClickObservable.add(() => {
      this._selectedMode = 'pvp';
      this._showModeSelect();
    });
    panel.addControl(pvpBtn);
  }

  // ---- Mode select sub-menu ----

  _createModeSelectPanel(gui) {
    const backdrop = new Rectangle('modeBackdrop');
    backdrop.widthInPixels = 240;
    backdrop.heightInPixels = 280;
    backdrop.cornerRadius = 10;
    backdrop.thickness = 0;
    backdrop.background = 'rgba(0, 0, 0, 0.5)';
    backdrop.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    backdrop.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    backdrop.left = '-40px';
    gui.addControl(backdrop);
    this._modeBackdrop = backdrop;

    const panel = new StackPanel('modePanel');
    panel.widthInPixels = 220;
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    panel.left = '-50px';
    panel.spacing = 10;
    gui.addControl(panel);
    this._modePanel = panel;

    // Back button
    const backBtn = this._createMenuButton('Back', false);
    backBtn.onPointerClickObservable.add(() => {
      this._showMainMenu();
    });
    panel.addControl(backBtn);

    // Color selector row
    const colorRow = new StackPanel('colorRow');
    colorRow.isVertical = false;
    colorRow.widthInPixels = 200;
    colorRow.heightInPixels = 55;
    panel.addControl(colorRow);

    const leftArrow = this._createArrowButton('arrowLeft', '\u25C0');
    leftArrow.onPointerClickObservable.add(() => {
      this._cyclePalette(-1);
    });
    colorRow.addControl(leftArrow);

    const colorLabel = new TextBlock('colorLabel', KNIGHT_PALETTES[this._paletteIndex].name);
    colorLabel.widthInPixels = 110;
    colorLabel.heightInPixels = 55;
    colorLabel.fontSize = 22;
    colorLabel.fontFamily = 'monospace';
    colorLabel.color = '#FFD740';
    colorLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    colorLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    colorRow.addControl(colorLabel);
    this._colorLabel = colorLabel;

    const rightArrow = this._createArrowButton('arrowRight', '\u25B6');
    rightArrow.onPointerClickObservable.add(() => {
      this._cyclePalette(1);
    });
    colorRow.addControl(rightArrow);

    // Play button — disabled placeholder
    const playBtn = this._createMenuButton('Play', true);
    panel.addControl(playBtn);
  }

  // ---- Menu helpers ----

  _showMainMenu() {
    this._menuState = 'main';
    this._mainBackdrop.isVisible = true;
    this._mainPanel.isVisible = true;
    this._modeBackdrop.isVisible = false;
    this._modePanel.isVisible = false;
  }

  _showModeSelect() {
    this._menuState = 'modeSelect';
    this._mainBackdrop.isVisible = false;
    this._mainPanel.isVisible = false;
    this._modeBackdrop.isVisible = true;
    this._modePanel.isVisible = true;
  }

  _cyclePalette(direction) {
    this._paletteIndex = ((this._paletteIndex + direction) % 4 + 4) % 4;
    this._colorLabel.text = KNIGHT_PALETTES[this._paletteIndex].name;
    this._buildKnight(this._paletteIndex);
  }

  _createMenuButton(label, disabled) {
    const btn = Button.CreateSimpleButton(`btn_${label}`, label);
    btn.widthInPixels = 200;
    btn.heightInPixels = 55;
    btn.cornerRadius = 14;
    btn.fontSize = 26;
    btn.fontFamily = 'monospace';

    if (btn.textBlock) {
      btn.textBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    }

    if (disabled) {
      btn.background = '#2A2724';
      btn.color = '#9A9590';
      btn.thickness = 1;
      btn.hoverCursor = 'default';

      btn.onPointerEnterObservable.add(() => {
        btn.background = '#352F2C';
      });
      btn.onPointerOutObservable.add(() => {
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

  _createArrowButton(name, label) {
    const btn = Button.CreateSimpleButton(name, label);
    btn.widthInPixels = 45;
    btn.heightInPixels = 55;
    btn.cornerRadius = 14;
    btn.fontSize = 26;
    btn.fontFamily = 'monospace';
    btn.background = '#2A2520';
    btn.color = '#FFD740';
    btn.thickness = 2;

    if (btn.textBlock) {
      btn.textBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    }

    btn.onPointerEnterObservable.add(() => {
      btn.background = '#3A3530';
      btn.color = '#FFF176';
    });
    btn.onPointerOutObservable.add(() => {
      btn.background = '#2A2520';
      btn.color = '#FFD740';
    });

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
      parts.leftWing.mesh.rotation.z = wingFlare;
    }
    if (parts.rightWing) {
      parts.rightWing.mesh.rotation.z = -wingFlare;
    }

    // Legs: alternate subtle bend synced with body weight shift
    const legBend = Math.sin(t * (2 * Math.PI / 5)) * 0.03;
    if (parts.leftLeg) {
      parts.leftLeg.mesh.rotation.x = -legBend;
    }
    if (parts.rightLeg) {
      parts.rightLeg.mesh.rotation.x = legBend;
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

    // Lava burst spawning — random interval between 0.4s and 1.5s
    if (this._lavaBurstTimer !== undefined) {
      this._lavaBurstTimer -= dt;
      if (this._lavaBurstTimer <= 0) {
        this._spawnLavaBurst();
        this._lavaBurstTimer = 0.4 + Math.random() * 1.1;
      }
    }
  }
}
