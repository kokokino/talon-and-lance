// MainMenuScene — full menu scene with voxel knight+ostrich on stone platforms
// over animated lava, with three menu buttons
// Receives Engine/Scene/AudioManager from BabylonPage — does not own them.

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
import { Tracker } from 'meteor/tracker';
import { HighScores } from '../../lib/collections/highScores.js';

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { buildRig } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { KNIGHT_PALETTES, buildKnightPalette } from '../voxels/models/knightPalettes.js';

const VOXEL_SIZE = 0.18;

export class MainMenuScene {
  /**
   * @param {{ audioManager: AudioManager, paletteIndex: number, onPlay: function }} config
   */
  constructor({ audioManager, paletteIndex, onPlay }) {
    this._audioManager = audioManager;
    this._onPlay = onPlay;

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

    // Menu state machine
    this._menuState = 'main';   // 'main' | 'modeSelect' | 'highScores' | 'instructions'
    this._selectedMode = null;  // 'team' | 'pvp'

    // High scores panel refs
    this._highScoresBackdrop = null;
    this._highScoresPanel = null;
    this._highScoresSub = null;
    this._paletteIndex = paletteIndex;

    // GUI references
    this._gui = null;
    this._mainBackdrop = null;
    this._mainPanel = null;
    this._modeBackdrop = null;
    this._modePanel = null;
    this._colorLabel = null;
    this._trackLabel = null;

    // Title text
    this._titleText = null;

    // Instructions panel refs
    this._instructionsBackdrop = null;
    this._instructionsPanel = null;
    this._instructionsKeyHandler = null;
    this._instrModeBody = null;
    this._instrPrompt = null;

    // Gamepad navigation
    this._focusIndex = 0;
    this._gamepadActive = false;
    this._prevButtons = null;
    this._prevAxes = null;

    // Button references for gamepad nav
    this._hubBtn = null;
    this._teamBtn = null;
    this._pvpBtn = null;
    this._scoresBtn = null;
    this._modeBackBtn = null;
    this._colorRow = null;
    this._trackRow = null;
    this._playBtn = null;
    this._scoresBackBtn = null;
    this._navMap = { main: [], modeSelect: [], highScores: [], instructions: [] };
  }

  /**
   * Build all scene content into the provided Scene.
   * @param {Scene} scene
   * @param {Engine} engine
   * @param {HTMLCanvasElement} canvas
   */
  create(scene, engine, canvas) {
    this.scene = scene;
    this.engine = engine;
    this.canvas = canvas;
    this.scene.clearColor = new Color4(0.12, 0.10, 0.10, 1); // Deep charcoal

    this._setupCamera();
    this._setupLighting();
    this._createLava();
    this._createPlatforms();
    this._createCharacters();
    this._createMenuButtons();

    // Lava ambient + burst SFX
    if (this._audioManager) {
      this._audioManager.loadGameSfx().then(() => {
        this._audioManager?.startLavaAmbient();
      });
    }

    // Animation callback + gamepad polling
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this._updateAnimations(dt);
      this._pollGamepad();
    });

    // Gamepad disconnect — clear focus highlight
    this._onGamepadDisconnected = () => {
      const items = this._navMap[this._menuState];
      if (this._gamepadActive && items && items.length > 0 && this._focusIndex < items.length) {
        this._applyFocus(items[this._focusIndex], false);
      }
      this._gamepadActive = false;
      this._prevButtons = null;
      this._prevAxes = null;
    };
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }

  /**
   * Dispose scene-specific resources (meshes, materials, GUI, particles).
   * Does NOT dispose Engine, audio, or the Scene itself — BabylonPage handles that.
   */
  dispose() {
    this._audioManager?.stopLavaAmbient();
    if (this._highScoresSub) {
      this._highScoresSub.stop();
      this._highScoresSub = null;
    }
    if (this._highScoresComputation) {
      this._highScoresComputation.stop();
      this._highScoresComputation = null;
    }
    if (this._instructionsKeyHandler) {
      window.removeEventListener('keydown', this._instructionsKeyHandler);
      this._instructionsKeyHandler = null;
    }
    if (this._onGamepadDisconnected) {
      window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
      this._onGamepadDisconnected = null;
    }
    this._prevButtons = null;
    this._prevAxes = null;
    this._navMap = { main: [], modeSelect: [], highScores: [], instructions: [] };
    if (this._gui) {
      this._gui.dispose();
      this._gui = null;
    }
    // Rigs and materials are tied to the Scene and will be disposed when
    // BabylonPage disposes the Scene. Clear references to avoid stale access.
    this.knightRig = null;
    this.lanceRig = null;
    this.ostrichRig = null;
    this.leftShoulderNode = null;
    this.rightShoulderNode = null;
    this.lavaMaterial = null;
    this.scene = null;
    this.engine = null;
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
    this._audioManager?.playSfx('lava-burst', 2);

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
   * @param {number} paletteIndex — 0-3
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
    this._createTitle(gui);
    this._createMainPanel(gui);
    this._createModeSelectPanel(gui);
    this._buildNavMap();
    this._showMainMenu();
  }

  // ---- Main menu panel ----

  _createMainPanel(gui) {
    const backdrop = new Rectangle('mainBackdrop');
    backdrop.widthInPixels = 240;
    backdrop.heightInPixels = 260;
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
    this._hubBtn = hubBtn;
    hubBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
      const hubUrl = Meteor.settings.public?.hubUrl;
      if (hubUrl) {
        window.location.href = hubUrl;
      }
    });
    panel.addControl(hubBtn);

    // Team Play — opens mode select
    const teamBtn = this._createMenuButton('Team Play', false);
    this._teamBtn = teamBtn;
    teamBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
      this._selectedMode = 'team';
      this._showModeSelect();
    });
    panel.addControl(teamBtn);

    // PvP Arena — opens mode select
    const pvpBtn = this._createMenuButton('PvP Arena', false);
    this._pvpBtn = pvpBtn;
    pvpBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
      this._selectedMode = 'pvp';
      this._showModeSelect();
    });
    panel.addControl(pvpBtn);

    // High Scores
    const scoresBtn = this._createMenuButton('High Scores', false);
    this._scoresBtn = scoresBtn;
    scoresBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
      this._showHighScores();
    });
    panel.addControl(scoresBtn);
  }

  // ---- Mode select sub-menu ----

  _createModeSelectPanel(gui) {
    const backdrop = new Rectangle('modeBackdrop');
    backdrop.widthInPixels = 240;
    backdrop.heightInPixels = 350;
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
    this._modeBackBtn = backBtn;
    backBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-cancel');
      this._showMainMenu();
    });
    panel.addControl(backBtn);

    // Color selector row
    const colorRow = new StackPanel('colorRow');
    this._colorRow = colorRow;
    colorRow.isVertical = false;
    colorRow.widthInPixels = 180;
    colorRow.heightInPixels = 55;
    panel.addControl(colorRow);

    const leftArrow = this._createArrowButton('arrowLeft', '\u25C0');
    leftArrow.onPointerClickObservable.add(() => {
      this._cyclePalette(-1);
    });
    colorRow.addControl(leftArrow);

    const colorLabel = new TextBlock('colorLabel', KNIGHT_PALETTES[this._paletteIndex].name);
    colorLabel.widthInPixels = 100;
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

    // Track selector row
    const trackRow = new StackPanel('trackRow');
    this._trackRow = trackRow;
    trackRow.isVertical = false;
    trackRow.widthInPixels = 180;
    trackRow.heightInPixels = 55;
    panel.addControl(trackRow);

    const trackLeftArrow = this._createArrowButton('trackArrowLeft', '\u25C0');
    trackLeftArrow.onPointerClickObservable.add(() => {
      this._cycleTrack(-1);
    });
    trackRow.addControl(trackLeftArrow);

    const trackLabel = new TextBlock('trackLabel', this._audioManager.getTrackName());
    trackLabel.widthInPixels = 100;
    trackLabel.heightInPixels = 55;
    trackLabel.fontSize = 22;
    trackLabel.fontFamily = 'monospace';
    trackLabel.color = '#FFD740';
    trackLabel.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    trackLabel.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    trackRow.addControl(trackLabel);
    this._trackLabel = trackLabel;

    const trackRightArrow = this._createArrowButton('trackArrowRight', '\u25B6');
    trackRightArrow.onPointerClickObservable.add(() => {
      this._cycleTrack(1);
    });
    trackRow.addControl(trackRightArrow);

    // Play button — enabled, triggers scene transition
    const playBtn = this._createMenuButton('Play', false);
    this._playBtn = playBtn;
    playBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
      this._showInstructions();
    });
    panel.addControl(playBtn);
  }

  // ---- Menu helpers ----

  _showMainMenu() {
    this._resetFocusForTransition();
    this._menuState = 'main';
    this._mainBackdrop.isVisible = true;
    this._mainPanel.isVisible = true;
    this._modeBackdrop.isVisible = false;
    this._modePanel.isVisible = false;
    if (this._highScoresBackdrop) {
      this._highScoresBackdrop.isVisible = false;
    }
    if (this._highScoresPanel) {
      this._highScoresPanel.isVisible = false;
    }
    if (this._instructionsBackdrop) {
      this._instructionsBackdrop.isVisible = false;
    }
    if (this._instructionsPanel) {
      this._instructionsPanel.isVisible = false;
    }
    if (this._instructionsKeyHandler) {
      window.removeEventListener('keydown', this._instructionsKeyHandler);
      this._instructionsKeyHandler = null;
    }
    if (this._highScoresSub) {
      this._highScoresSub.stop();
      this._highScoresSub = null;
    }
    if (this._highScoresComputation) {
      this._highScoresComputation.stop();
      this._highScoresComputation = null;
    }
    this._applyInitialFocus();
  }

  _showModeSelect() {
    this._resetFocusForTransition();
    this._menuState = 'modeSelect';
    this._mainBackdrop.isVisible = false;
    this._mainPanel.isVisible = false;
    this._modeBackdrop.isVisible = true;
    this._modePanel.isVisible = true;
    if (this._instructionsBackdrop) {
      this._instructionsBackdrop.isVisible = false;
    }
    if (this._instructionsPanel) {
      this._instructionsPanel.isVisible = false;
    }
    if (this._instructionsKeyHandler) {
      window.removeEventListener('keydown', this._instructionsKeyHandler);
      this._instructionsKeyHandler = null;
    }
    this._applyInitialFocus();
  }

  _showHighScores() {
    this._resetFocusForTransition();
    this._menuState = 'highScores';
    this._mainBackdrop.isVisible = false;
    this._mainPanel.isVisible = false;
    this._modeBackdrop.isVisible = false;
    this._modePanel.isVisible = false;

    if (!this._highScoresBackdrop) {
      this._createHighScoresPanel(this._gui);
    }
    this._highScoresBackdrop.isVisible = true;
    this._highScoresPanel.isVisible = true;

    // Subscribe and reactively update
    this._highScoresSub = Meteor.subscribe('highScores.top10');
    this._highScoresComputation = Tracker.autorun(() => {
      const scores = HighScores.find({}, { sort: { score: -1 }, limit: 10 }).fetch();
      this._updateHighScoresDisplay(scores);
    });
    this._applyInitialFocus();
  }

  _createHighScoresPanel(gui) {
    const backdrop = new Rectangle('scoresBackdrop');
    backdrop.widthInPixels = 340;
    backdrop.heightInPixels = 450;
    backdrop.cornerRadius = 10;
    backdrop.thickness = 0;
    backdrop.background = 'rgba(0, 0, 0, 0.7)';
    backdrop.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    backdrop.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    backdrop.left = '-40px';
    backdrop.isVisible = false;
    gui.addControl(backdrop);
    this._highScoresBackdrop = backdrop;

    const panel = new StackPanel('scoresPanel');
    panel.widthInPixels = 320;
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    panel.left = '-50px';
    panel.spacing = 4;
    panel.isVisible = false;
    gui.addControl(panel);
    this._highScoresPanel = panel;

    // Title
    const title = new TextBlock('scoresTitle', 'HIGH SCORES');
    title.heightInPixels = 40;
    title.fontSize = 28;
    title.fontFamily = 'monospace';
    title.color = '#FFD700';
    title.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(title);

    // Score entries (10 placeholder rows)
    this._scoreRows = [];
    for (let i = 0; i < 10; i++) {
      const row = new TextBlock(`scoreRow_${i}`, `${i + 1}. ---`);
      row.heightInPixels = 28;
      row.fontSize = 18;
      row.fontFamily = 'monospace';
      row.color = i < 3 ? '#FFD740' : '#FFFFFF';
      row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
      row.paddingLeftInPixels = 10;
      panel.addControl(row);
      this._scoreRows.push(row);
    }

    // Back button
    const scoresBackBtn = this._createMenuButton('Back', false);
    this._scoresBackBtn = scoresBackBtn;
    this._navMap.highScores = [
      { control: scoresBackBtn, onConfirm: () => { this._showMainMenu(); } }
    ];
    scoresBackBtn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-cancel');
      this._showMainMenu();
    });
    panel.addControl(scoresBackBtn);
  }

  _updateHighScoresDisplay(scores) {
    if (!this._scoreRows) {
      return;
    }
    for (let i = 0; i < 10; i++) {
      if (i < scores.length) {
        const s = scores[i];
        const name = (s.username || 'Anon').substring(0, 12).padEnd(12);
        const pts = String(s.score).padStart(7);
        this._scoreRows[i].text = `${i + 1}. ${name} ${pts}`;
      } else {
        this._scoreRows[i].text = `${i + 1}. ---`;
      }
    }
  }

  async _cycleTrack(direction) {
    await this._audioManager.cycleTrack(direction);
    this._trackLabel.text = this._audioManager.getTrackName();
  }

  _cyclePalette(direction) {
    this._paletteIndex = ((this._paletteIndex + direction) % 4 + 4) % 4;
    localStorage.setItem('talon-lance:paletteIndex', this._paletteIndex);
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
        this._audioManager.playSfx('ui-hover');
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
    btn.widthInPixels = 40;
    btn.heightInPixels = 55;
    btn.cornerRadius = 14;
    btn.fontSize = 22;
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
      this._audioManager.playSfx('ui-hover');
    });
    btn.onPointerOutObservable.add(() => {
      btn.background = '#2A2520';
      btn.color = '#FFD740';
    });
    btn.onPointerClickObservable.add(() => {
      this._audioManager.playSfx('ui-select');
    });

    return btn;
  }

  // ---- Title ----

  _createTitle(gui) {
    const title = new TextBlock('gameTitle', 'TALON & LANCE');
    title.fontSize = 52;
    title.fontFamily = 'monospace';
    title.color = '#FFD740';
    title.outlineWidth = 4;
    title.outlineColor = '#000000';
    title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    title.top = '30px';
    title.heightInPixels = 70;
    gui.addControl(title);
    this._titleText = title;
  }

  // ---- Instructions screen ----

  _createInstructionsPanel(gui) {
    // Full-screen semi-transparent backdrop
    const backdrop = new Rectangle('instrBackdrop');
    backdrop.width = '100%';
    backdrop.height = '100%';
    backdrop.thickness = 0;
    backdrop.background = 'rgba(0, 0, 0, 0.75)';
    backdrop.isVisible = false;
    gui.addControl(backdrop);
    this._instructionsBackdrop = backdrop;

    const panel = new StackPanel('instrPanel');
    panel.widthInPixels = 500;
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    panel.spacing = 8;
    panel.isVisible = false;
    gui.addControl(panel);
    this._instructionsPanel = panel;

    // Heading
    const heading = new TextBlock('instrHeading', 'HOW TO PLAY');
    heading.heightInPixels = 50;
    heading.fontSize = 32;
    heading.fontFamily = 'monospace';
    heading.color = '#FFD740';
    heading.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(heading);

    // Controls section heading
    const controlsHead = new TextBlock('ctrlHead', 'CONTROLS');
    controlsHead.heightInPixels = 35;
    controlsHead.fontSize = 22;
    controlsHead.fontFamily = 'monospace';
    controlsHead.color = '#FFF176';
    controlsHead.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(controlsHead);

    // Control lines
    const controlLines = [
      'Move: Arrow Keys or A/D  |  D-pad or Left Stick',
      'Flap: Any Other Key  |  Any Face Button',
      'End Game: Escape  |  Start Button',
    ];
    for (const line of controlLines) {
      const text = new TextBlock(`ctrl_${line.substring(0, 8)}`, line);
      text.heightInPixels = 28;
      text.fontSize = 16;
      text.fontFamily = 'monospace';
      text.color = '#FFFFFF';
      text.textWrapping = 1; // TextWrapping.WordWrap
      text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      panel.addControl(text);
    }

    // Spacer
    const spacer1 = new TextBlock('spacer1', '');
    spacer1.heightInPixels = 10;
    panel.addControl(spacer1);

    // Objective section
    const objectiveHead = new TextBlock('objHead', 'OBJECTIVE');
    objectiveHead.heightInPixels = 35;
    objectiveHead.fontSize = 22;
    objectiveHead.fontFamily = 'monospace';
    objectiveHead.color = '#FFF176';
    objectiveHead.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(objectiveHead);

    const objectiveBody = new TextBlock('objBody',
      'Fly above your enemies — the higher lance wins! ' +
      'When an enemy is defeated, they drop an egg. ' +
      'Collect eggs before they hatch into tougher foes.'
    );
    objectiveBody.heightInPixels = 65;
    objectiveBody.fontSize = 16;
    objectiveBody.fontFamily = 'monospace';
    objectiveBody.color = '#FFFFFF';
    objectiveBody.textWrapping = 1; // TextWrapping.WordWrap
    objectiveBody.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(objectiveBody);

    // Spacer
    const spacer2 = new TextBlock('spacer2', '');
    spacer2.heightInPixels = 10;
    panel.addControl(spacer2);

    // Game mode section
    const modeHead = new TextBlock('modeHead', 'GAME MODE');
    modeHead.heightInPixels = 35;
    modeHead.fontSize = 22;
    modeHead.fontFamily = 'monospace';
    modeHead.color = '#FFF176';
    modeHead.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(modeHead);

    const modeBody = new TextBlock('modeBody', '');
    modeBody.heightInPixels = 45;
    modeBody.fontSize = 16;
    modeBody.fontFamily = 'monospace';
    modeBody.color = '#FFFFFF';
    modeBody.textWrapping = 1; // TextWrapping.WordWrap
    modeBody.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(modeBody);
    this._instrModeBody = modeBody;

    // Spacer
    const spacer3 = new TextBlock('spacer3', '');
    spacer3.heightInPixels = 20;
    panel.addControl(spacer3);

    // Pulsing prompt
    const prompt = new TextBlock('instrPrompt', 'Press any key to continue');
    prompt.heightInPixels = 35;
    prompt.fontSize = 20;
    prompt.fontFamily = 'monospace';
    prompt.color = '#FFD740';
    prompt.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    panel.addControl(prompt);
    this._instrPrompt = prompt;
  }

  _showInstructions() {
    this._resetFocusForTransition();
    this._menuState = 'instructions';
    this._mainBackdrop.isVisible = false;
    this._mainPanel.isVisible = false;
    this._modeBackdrop.isVisible = false;
    this._modePanel.isVisible = false;

    if (!this._instructionsBackdrop) {
      this._createInstructionsPanel(this._gui);
    }

    // Update mode description
    if (this._selectedMode === 'team') {
      this._instrModeBody.text = 'Team Play — work together with up to 4 players to defeat waves of enemy knights.';
    } else {
      this._instrModeBody.text = 'PvP Arena — up to 4 players battle each other. Last knight standing wins!';
    }

    this._instructionsBackdrop.isVisible = true;
    this._instructionsPanel.isVisible = true;

    if (this._audioManager) {
      this._audioManager.playIntroTheme();
    }

    // Keyboard listener — any key starts, Escape goes back
    this._instructionsKeyHandler = (e) => {
      if (this._menuState !== 'instructions') {
        return;
      }
      if (e.key === 'Escape') {
        setTimeout(() => this._handleCancel(), 0);
      } else {
        setTimeout(() => this._dismissInstructions(), 0);
      }
    };
    window.addEventListener('keydown', this._instructionsKeyHandler);
  }

  _dismissInstructions() {
    if (this._menuState !== 'instructions') {
      return;
    }
    if (this._instructionsKeyHandler) {
      window.removeEventListener('keydown', this._instructionsKeyHandler);
      this._instructionsKeyHandler = null;
    }
    if (this._audioManager) {
      this._audioManager.stopIntroTheme();
    }
    if (this._instructionsBackdrop) {
      this._instructionsBackdrop.isVisible = false;
    }
    if (this._instructionsPanel) {
      this._instructionsPanel.isVisible = false;
    }
    if (this._onPlay) {
      this._onPlay(this._paletteIndex, this._selectedMode);
    }
  }

  _animateInstructionsPrompt() {
    if (!this._instrPrompt || this._menuState !== 'instructions') {
      return;
    }
    // Pulse alpha between 0.3 and 1.0 on a ~2s sine cycle
    const alpha = 0.65 + 0.35 * Math.sin(this.elapsed * Math.PI);
    this._instrPrompt.alpha = alpha;
  }

  // ---- Gamepad navigation ----

  _buildNavMap() {
    this._navMap.main = [
      {
        control: this._hubBtn,
        onConfirm: () => {
          const hubUrl = Meteor.settings.public?.hubUrl;
          if (hubUrl) {
            window.location.href = hubUrl;
          }
        }
      },
      {
        control: this._teamBtn,
        onConfirm: () => {
          this._selectedMode = 'team';
          this._showModeSelect();
        }
      },
      {
        control: this._pvpBtn,
        onConfirm: () => {
          this._selectedMode = 'pvp';
          this._showModeSelect();
        }
      },
      {
        control: this._scoresBtn,
        onConfirm: () => {
          this._showHighScores();
        }
      }
    ];
    this._navMap.modeSelect = [
      {
        control: this._modeBackBtn,
        onConfirm: () => { this._showMainMenu(); }
      },
      {
        control: this._colorRow,
        onConfirm: () => { this._cyclePalette(1); },
        onLeft: () => { this._cyclePalette(-1); },
        onRight: () => { this._cyclePalette(1); }
      },
      {
        control: this._trackRow,
        onConfirm: () => { this._cycleTrack(1); },
        onLeft: () => { this._cycleTrack(-1); },
        onRight: () => { this._cycleTrack(1); }
      },
      {
        control: this._playBtn,
        onConfirm: () => {
          this._showInstructions();
        }
      }
    ];
    // highScores nav map populated lazily in _createHighScoresPanel
  }

  _pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }
    if (!gp) {
      return;
    }

    const buttons = gp.buttons.map(b => b.pressed);
    const axes = gp.axes.slice();
    const prev = this._prevButtons;
    const prevAxes = this._prevAxes;

    // Rising edge (button down) — used for navigation
    const pressed = (idx) => idx < buttons.length && buttons[idx] && (!prev || !prev[idx]);
    // Falling edge (button up) — used for confirm/cancel actions.
    // Immune to stale gamepad data from page navigation: stale data is frozen
    // with buttons stuck "pressed" and can never produce a release transition.
    const released = (idx) => idx < buttons.length && !buttons[idx] && prev && prev[idx];

    // Axis to digital with deadzone
    const DEADZONE = 0.5;
    const axisDigital = (val) => {
      if (val < -DEADZONE) {
        return -1;
      }
      if (val > DEADZONE) {
        return 1;
      }
      return 0;
    };
    const axisX = axisDigital(axes[0] || 0);
    const axisY = axisDigital(axes[1] || 0);
    const prevAxisX = prevAxes ? axisDigital(prevAxes[0] || 0) : 0;
    const prevAxisY = prevAxes ? axisDigital(prevAxes[1] || 0) : 0;

    // Detect rising edges for directions
    const upPressed = pressed(12) || (axisY === -1 && prevAxisY !== -1);
    const downPressed = pressed(13) || (axisY === 1 && prevAxisY !== 1);
    const leftPressed = pressed(14) || (axisX === -1 && prevAxisX !== -1);
    const rightPressed = pressed(15) || (axisX === 1 && prevAxisX !== 1);
    const confirmPressed = released(0);
    const cancelPressed = released(1);

    this._prevButtons = buttons;
    this._prevAxes = axes;

    // Instructions state: any face button starts game, cancel goes back
    if (this._menuState === 'instructions') {
      const anyFaceButton = pressed(0) || pressed(1) || pressed(2) || pressed(3);
      if (cancelPressed) {
        setTimeout(() => this._handleCancel(), 0);
      } else if (anyFaceButton || confirmPressed) {
        setTimeout(() => this._dismissInstructions(), 0);
      }
      return;
    }

    const anyInput = upPressed || downPressed || leftPressed || rightPressed || confirmPressed || cancelPressed;
    if (!anyInput) {
      return;
    }

    // Activate gamepad mode on first input
    if (!this._gamepadActive) {
      this._gamepadActive = true;
      const items = this._navMap[this._menuState];
      if (items && items.length > 0) {
        this._applyFocus(items[this._focusIndex], true);
      }
    }

    const items = this._navMap[this._menuState];
    if (!items || items.length === 0) {
      return;
    }

    if (upPressed) {
      this._moveFocus(-1);
    } else if (downPressed) {
      this._moveFocus(1);
    } else if (leftPressed) {
      const item = items[this._focusIndex];
      if (item.onLeft) {
        item.onLeft();
      }
    } else if (rightPressed) {
      const item = items[this._focusIndex];
      if (item.onRight) {
        item.onRight();
      }
    } else if (confirmPressed) {
      const item = items[this._focusIndex];
      if (item.onConfirm) {
        this._audioManager.playSfx('ui-select');
        // Defer to avoid disposing the scene mid-render (pollGamepad runs
        // inside onBeforeRenderObservable, so a scene transition here would
        // destroy the camera before Scene.render() finishes).
        const action = item.onConfirm;
        setTimeout(action, 0);
      }
    } else if (cancelPressed) {
      setTimeout(() => this._handleCancel(), 0);
    }
  }

  _handleCancel() {
    if (this._menuState === 'instructions') {
      this._audioManager.playSfx('ui-cancel');
      if (this._audioManager) {
        this._audioManager.stopIntroTheme();
      }
      this._showModeSelect();
    } else if (this._menuState === 'modeSelect' || this._menuState === 'highScores') {
      this._audioManager.playSfx('ui-cancel');
      this._showMainMenu();
    }
  }

  _moveFocus(direction) {
    const items = this._navMap[this._menuState];
    if (!items || items.length === 0) {
      return;
    }

    this._applyFocus(items[this._focusIndex], false);
    this._focusIndex = ((this._focusIndex + direction) % items.length + items.length) % items.length;
    this._applyFocus(items[this._focusIndex], true);
    this._audioManager.playSfx('ui-hover');
  }

  _applyFocus(item, focused) {
    const control = item.control;
    if (control instanceof StackPanel) {
      // Selector row — brighten/dim all children
      for (let i = 0; i < control.children.length; i++) {
        const child = control.children[i];
        if (child instanceof Button) {
          child.background = focused ? '#3A3530' : '#2A2520';
          child.color = focused ? '#FFF176' : '#FFD740';
        } else if (child instanceof TextBlock) {
          child.color = focused ? '#FFF176' : '#FFD740';
        }
      }
    } else {
      control.background = focused ? '#3A3530' : '#2A2520';
      control.color = focused ? '#FFF176' : '#FFD740';
    }
  }

  _resetFocusForTransition() {
    const items = this._navMap[this._menuState];
    if (items && items.length > 0 && this._focusIndex < items.length) {
      this._applyFocus(items[this._focusIndex], false);
    }
    this._focusIndex = 0;
  }

  _applyInitialFocus() {
    if (this._gamepadActive) {
      const items = this._navMap[this._menuState];
      if (items && items.length > 0) {
        this._applyFocus(items[0], true);
      }
    }
  }

  // ---- Animation ----

  _updateAnimations(dt) {
    this.elapsed += dt;
    this._animateKnight();
    this._animateOstrich();
    this._animateLava(dt);
    this._animateInstructionsPrompt();
  }

  _animateKnight() {
    const t = this.elapsed;
    const parts = this.knightRig?.parts;
    if (!parts) {
      return;
    }

    // Torso: gentle breathing bob — Y oscillates +-0.02, period ~3s
    if (parts.torso) {
      parts.torso.mesh.position.y = Math.sin(t * (2 * Math.PI / 3)) * 0.02;
    }

    // Head: slight independent nod — rotation.x +-0.03 rad, period ~4s
    if (parts.head) {
      parts.head.mesh.rotation.x = Math.sin(t * (2 * Math.PI / 4)) * 0.03;
    }

    // Arms: subtle sway via shoulder joints — rotation.z +-0.02 rad, period ~3.5s
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

    // Body: weight shift — tilts rotation.z +-0.015 rad, period ~5s
    if (parts.body) {
      parts.body.mesh.rotation.z = Math.sin(t * (2 * Math.PI / 5)) * 0.015;
    }

    // Neck+Head: bob up/down (rotation.x +-0.08, period ~2s) + look left/right (rotation.y +-0.15, period ~6s)
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
    if (parts.leftThigh) {
      parts.leftThigh.mesh.rotation.x = -legBend;
    }
    if (parts.rightThigh) {
      parts.rightThigh.mesh.rotation.x = legBend;
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
