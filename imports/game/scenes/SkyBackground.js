// SkyBackground — dynamic sky with day/night cycle, sun/moon, stars, lightning, clouds.
// All background elements live at z > 0 (behind game action at z=0).

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildPart } from '../voxels/VoxelBuilder.js';

// Full day/night cycle duration in seconds
const CYCLE_DURATION = 60;

// Cloud drift speed range (units/sec)
const CLOUD_DRIFT_MIN = 0.3;
const CLOUD_DRIFT_MAX = 0.8;

// Lightning timing
const LIGHTNING_MIN_INTERVAL = 8;
const LIGHTNING_MAX_INTERVAL = 15;

// ---- Inline voxel cloud models ----

const CLOUD_PALETTE = { 1: '#FFFFFF', 2: '#DDDDEE', 3: '#BBBBCC' };

// Small cloud: 6w × 2d × 2h
const smallCloud = {
  offset: [0, 0, 0],
  layers: [
    // y=0
    [
      [0, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 0, 0],
    ],
    // y=1
    [
      [0, 0, 2, 2, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
  ],
};

// Medium cloud: 10w × 3d × 3h
const mediumCloud = {
  offset: [0, 0, 0],
  layers: [
    // y=0
    [
      [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
    ],
    // y=1
    [
      [0, 0, 0, 2, 1, 1, 2, 0, 0, 0],
      [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
    ],
    // y=2
    [
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
      [0, 0, 0, 2, 2, 2, 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  ],
};

// Large cloud: 14w × 3d × 4h
const largeCloud = {
  offset: [0, 0, 0],
  layers: [
    // y=0
    [
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    ],
    // y=1
    [
      [0, 0, 0, 2, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0],
      [0, 0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0],
      [0, 0, 0, 0, 2, 1, 1, 1, 1, 2, 0, 0, 0, 0],
    ],
    // y=2
    [
      [0, 0, 0, 0, 0, 2, 1, 1, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 2, 1, 1, 1, 1, 2, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0],
    ],
    // y=3
    [
      [0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 2, 3, 3, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  ],
};

// Tiny cloud: 4w × 2d × 2h
const tinyCloud = {
  offset: [0, 0, 0],
  layers: [
    // y=0
    [
      [0, 1, 1, 0],
      [1, 1, 1, 1],
    ],
    // y=1
    [
      [0, 0, 0, 0],
      [0, 2, 2, 0],
    ],
  ],
};

const CLOUD_SHAPES = [smallCloud, mediumCloud, largeCloud, tinyCloud];

// ---- GLSL shaders for sky gradient + stars ----

const SKY_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUV = position.xy * 0.5 + 0.5;
}
`;

const SKY_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform float timeOfDay;
uniform float elapsed;
uniform vec2 resolution;

// Pseudo-random hash for star placement
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 mixGradient(float t) {
  // Color stops: midnight(0.0), dawn(0.2), noon(0.5), dusk(0.8), midnight(1.0)
  vec3 midnightTop   = vec3(0.039, 0.039, 0.102);
  vec3 midnightBot   = vec3(0.082, 0.082, 0.145);
  vec3 dawnTop        = vec3(0.165, 0.102, 0.227);
  vec3 dawnBot        = vec3(0.800, 0.400, 0.267);
  vec3 noonTop        = vec3(0.267, 0.533, 0.800);
  vec3 noonBot        = vec3(0.533, 0.733, 0.867);
  vec3 duskTop        = vec3(0.227, 0.102, 0.165);
  vec3 duskBot        = vec3(0.800, 0.400, 0.267);

  vec3 top, bot;
  if (t < 0.2) {
    float f = t / 0.2;
    top = mix(midnightTop, dawnTop, f);
    bot = mix(midnightBot, dawnBot, f);
  } else if (t < 0.5) {
    float f = (t - 0.2) / 0.3;
    top = mix(dawnTop, noonTop, f);
    bot = mix(dawnBot, noonBot, f);
  } else if (t < 0.8) {
    float f = (t - 0.5) / 0.3;
    top = mix(noonTop, duskTop, f);
    bot = mix(noonBot, duskBot, f);
  } else {
    float f = (t - 0.8) / 0.2;
    top = mix(duskTop, midnightTop, f);
    bot = mix(duskBot, midnightBot, f);
  }

  return mix(bot, top, vUV.y);
}

void main() {
  vec3 sky = mixGradient(timeOfDay);

  // Stars — visible during night (timeOfDay < 0.15 or > 0.85)
  float nightFade = 0.0;
  if (timeOfDay < 0.15) {
    nightFade = 1.0 - smoothstep(0.10, 0.15, timeOfDay);
  } else if (timeOfDay > 0.85) {
    nightFade = smoothstep(0.85, 0.90, timeOfDay);
  }

  if (nightFade > 0.0) {
    // Grid-based star placement — only upper 70% of sky
    vec2 starGrid = floor(vUV * 80.0);
    float starVal = hash(starGrid);
    if (starVal > 0.97 && vUV.y > 0.3) {
      float twinkle = 0.7 + 0.3 * sin(elapsed * 2.0 + starVal * 100.0);
      float brightness = twinkle * nightFade * (starVal - 0.97) / 0.03;
      sky += vec3(brightness * 0.8, brightness * 0.8, brightness);
    }
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

export class SkyBackground {
  /**
   * @param {Scene} scene
   * @param {number} orthoLeft
   * @param {number} orthoRight
   * @param {number} orthoBottom
   * @param {number} orthoTop
   */
  constructor(scene, orthoLeft, orthoRight, orthoBottom, orthoTop) {
    this._scene = scene;
    this._orthoLeft = orthoLeft;
    this._orthoRight = orthoRight;
    this._orthoBottom = orthoBottom;
    this._orthoTop = orthoTop;

    this._elapsed = 0;
    this._timeOfDay = 0;

    // Lightning state
    this._lightningTimer = 0;
    this._lightningInterval = this._randomLightningInterval();
    this._lightningFlashTimer = -1;

    // References
    this._skyPlane = null;
    this._skyMaterial = null;
    this._sunMesh = null;
    this._sunHalo = null;
    this._moonMesh = null;
    this._lightningPlane = null;
    this._lightningMaterial = null;
    this._voxelClouds = [];

    this._createSkyPlane();
    this._createSunMoon();
    this._createLightning();
    this._createVoxelClouds();
  }

  /** Current time of day 0–1 for external light modulation */
  get timeOfDay() {
    return this._timeOfDay;
  }

  update(dt) {
    this._elapsed += dt;
    this._timeOfDay = (this._elapsed % CYCLE_DURATION) / CYCLE_DURATION;

    this._updateSkyShader();
    this._updateSunMoon();
    this._updateLightning(dt);
    this._updateVoxelClouds(dt);
  }

  dispose() {
    if (this._skyPlane) {
      this._skyPlane.dispose();
    }
    if (this._skyMaterial) {
      this._skyMaterial.dispose();
    }
    if (this._sunMesh) {
      this._sunMesh.dispose();
    }
    if (this._sunHalo) {
      this._sunHalo.dispose();
    }
    if (this._moonMesh) {
      this._moonMesh.dispose();
    }
    if (this._lightningPlane) {
      this._lightningPlane.dispose();
    }
    if (this._lightningMaterial) {
      this._lightningMaterial.dispose();
    }
    for (const cloud of this._voxelClouds) {
      if (cloud.mesh) {
        cloud.mesh.dispose();
      }
    }
  }

  // ---- Sky gradient plane ----

  _createSkyPlane() {
    const width = this._orthoRight - this._orthoLeft + 2;
    const height = this._orthoTop - this._orthoBottom + 2;

    // Store shader source in Effect
    Effect.ShadersStore['skyVertexShader'] = SKY_VERTEX;
    Effect.ShadersStore['skyFragmentShader'] = SKY_FRAGMENT;

    this._skyMaterial = new ShaderMaterial('skyMat', this._scene, {
      vertex: 'sky',
      fragment: 'sky',
    }, {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'timeOfDay', 'elapsed', 'resolution'],
    });

    this._skyPlane = MeshBuilder.CreatePlane('skyPlane', {
      width,
      height,
    }, this._scene);
    this._skyPlane.position = new Vector3(0, (this._orthoTop + this._orthoBottom) / 2, 3);
    this._skyPlane.material = this._skyMaterial;

    // Initialize uniforms
    this._skyMaterial.setFloat('timeOfDay', 0);
    this._skyMaterial.setFloat('elapsed', 0);
    this._skyMaterial.setVector2('resolution', { x: width, y: height });
  }

  _updateSkyShader() {
    if (this._skyMaterial) {
      this._skyMaterial.setFloat('timeOfDay', this._timeOfDay);
      this._skyMaterial.setFloat('elapsed', this._elapsed);
    }
  }

  // ---- Sun / Moon ----

  _createSunMoon() {
    // Sun disc
    this._sunMesh = MeshBuilder.CreateDisc('sun', { radius: 0.5, tessellation: 24 }, this._scene);
    const sunMat = new StandardMaterial('sunMat', this._scene);
    sunMat.emissiveColor = new Color3(1.0, 0.95, 0.7);
    sunMat.diffuseColor = new Color3(0, 0, 0);
    sunMat.specularColor = new Color3(0, 0, 0);
    sunMat.disableLighting = true;
    this._sunMesh.material = sunMat;
    this._sunMesh.position.z = 2.5;

    // Moon disc
    this._moonMesh = MeshBuilder.CreateDisc('moon', { radius: 0.4, tessellation: 24 }, this._scene);
    const moonMat = new StandardMaterial('moonMat', this._scene);
    moonMat.emissiveColor = new Color3(0.7, 0.75, 0.9);
    moonMat.diffuseColor = new Color3(0, 0, 0);
    moonMat.specularColor = new Color3(0, 0, 0);
    moonMat.disableLighting = true;
    this._moonMesh.material = moonMat;
    this._moonMesh.position.z = 2.5;

    // Halo disc behind sun (depth-tested alternative to GlowLayer)
    this._sunHalo = MeshBuilder.CreateDisc('sunHalo', { radius: 0.7, tessellation: 24 }, this._scene);
    const haloMat = new StandardMaterial('sunHaloMat', this._scene);
    haloMat.disableLighting = true;
    haloMat.emissiveColor = new Color3(1.0, 0.95, 0.7);
    haloMat.diffuseColor = new Color3(0, 0, 0);
    haloMat.specularColor = new Color3(0, 0, 0);
    haloMat.alpha = 0.35;
    this._sunHalo.material = haloMat;
    this._sunHalo.hasVertexAlpha = false;
    this._sunHalo.position.z = 2.6; // slightly behind sun at z=2.5
  }

  _updateSunMoon() {
    const t = this._timeOfDay;
    const amplitude = (this._orthoRight - this._orthoLeft) * 0.4;
    const yRange = (this._orthoTop - this._orthoBottom) * 0.6;
    const yBase = this._orthoBottom + (this._orthoTop - this._orthoBottom) * 0.15;

    // Sun: visible during day (0.15–0.85)
    if (t >= 0.15 && t <= 0.85) {
      const sunPhase = (t - 0.15) / 0.7; // 0–1 across daytime
      const angle = sunPhase * Math.PI;   // 0–PI arc
      this._sunMesh.position.x = amplitude * Math.cos(angle);
      this._sunMesh.position.y = yBase + yRange * Math.sin(angle);

      // Fade near horizons
      let sunAlpha = 1;
      if (sunPhase < 0.1) {
        sunAlpha = sunPhase / 0.1;
      } else if (sunPhase > 0.9) {
        sunAlpha = (1 - sunPhase) / 0.1;
      }
      this._sunMesh.visibility = sunAlpha;
      this._sunMesh.setEnabled(true);

      // Move halo with sun
      this._sunHalo.position.x = this._sunMesh.position.x;
      this._sunHalo.position.y = this._sunMesh.position.y;
      this._sunHalo.material.alpha = 0.35 * sunAlpha;
      this._sunHalo.setEnabled(true);
    } else {
      this._sunMesh.setEnabled(false);
      this._sunHalo.setEnabled(false);
    }

    // Moon: visible during night (0.0–0.15 and 0.85–1.0)
    // Remap night portions to 0–1 for arc
    let moonPhase = -1;
    if (t >= 0.85) {
      moonPhase = (t - 0.85) / 0.3; // 0–0.5 for evening
    } else if (t <= 0.15) {
      moonPhase = (t + 0.15) / 0.3; // 0.5–1.0 for morning
    }

    if (moonPhase >= 0 && moonPhase <= 1) {
      const angle = moonPhase * Math.PI;
      this._moonMesh.position.x = amplitude * Math.cos(angle);
      this._moonMesh.position.y = yBase + yRange * 0.8 * Math.sin(angle);

      let moonAlpha = 1;
      if (moonPhase < 0.1) {
        moonAlpha = moonPhase / 0.1;
      } else if (moonPhase > 0.9) {
        moonAlpha = (1 - moonPhase) / 0.1;
      }
      this._moonMesh.visibility = moonAlpha;
      this._moonMesh.setEnabled(true);
    } else {
      this._moonMesh.setEnabled(false);
    }
  }

  // ---- Lightning ----

  _createLightning() {
    const width = this._orthoRight - this._orthoLeft + 2;
    const height = this._orthoTop - this._orthoBottom + 2;

    this._lightningPlane = MeshBuilder.CreatePlane('lightning', {
      width,
      height,
    }, this._scene);
    this._lightningPlane.position = new Vector3(0, (this._orthoTop + this._orthoBottom) / 2, 2);

    this._lightningMaterial = new StandardMaterial('lightningMat', this._scene);
    this._lightningMaterial.emissiveColor = new Color3(0.9, 0.9, 1.0);
    this._lightningMaterial.diffuseColor = new Color3(0, 0, 0);
    this._lightningMaterial.specularColor = new Color3(0, 0, 0);
    this._lightningMaterial.disableLighting = true;
    this._lightningMaterial.alpha = 0;
    this._lightningPlane.material = this._lightningMaterial;
    this._lightningPlane.hasVertexAlpha = false;
  }

  _updateLightning(dt) {
    const t = this._timeOfDay;
    const isStormTime = t < 0.25 || t > 0.75;

    this._lightningTimer += dt;

    // Trigger new flash
    if (isStormTime && this._lightningFlashTimer < 0 && this._lightningTimer >= this._lightningInterval) {
      this._lightningFlashTimer = 0;
      this._lightningTimer = 0;
      this._lightningInterval = this._randomLightningInterval();
    }

    // Animate flash: double-flash pattern
    if (this._lightningFlashTimer >= 0) {
      this._lightningFlashTimer += dt;
      const ft = this._lightningFlashTimer;
      let alpha = 0;

      if (ft < 0.04) {
        // First bright flash
        alpha = 0.6;
      } else if (ft < 0.09) {
        // Brief dim
        alpha = 0.1;
      } else if (ft < 0.13) {
        // Second bright flash
        alpha = 0.5;
      } else if (ft < 0.28) {
        // Fade out
        alpha = 0.5 * (1 - (ft - 0.13) / 0.15);
      } else {
        alpha = 0;
        this._lightningFlashTimer = -1;
      }

      this._lightningMaterial.alpha = alpha;
    }
  }

  _randomLightningInterval() {
    return LIGHTNING_MIN_INTERVAL + Math.random() * (LIGHTNING_MAX_INTERVAL - LIGHTNING_MIN_INTERVAL);
  }

  // ---- Voxel clouds ----

  _createVoxelClouds() {
    const count = 8;
    const voxelSize = 0.18;

    for (let i = 0; i < count; i++) {
      const shapeIdx = i % CLOUD_SHAPES.length;
      const shape = CLOUD_SHAPES[shapeIdx];
      const partName = `cloud_${i}`;

      const result = buildPart(this._scene, shape, CLOUD_PALETTE, voxelSize, partName);
      if (result) {
        const x = this._orthoLeft + Math.random() * (this._orthoRight - this._orthoLeft);
        const yMin = (this._orthoTop + this._orthoBottom) / 2;
        const yMax = this._orthoTop - 0.5;
        const y = yMin + Math.random() * (yMax - yMin);
        const speed = CLOUD_DRIFT_MIN + Math.random() * (CLOUD_DRIFT_MAX - CLOUD_DRIFT_MIN);

        result.mesh.position = new Vector3(x, y, 1.5);

        this._voxelClouds.push({
          mesh: result.mesh,
          speed,
          baseEmissive: new Color3(1, 1, 1),
        });
      }
    }
  }

  _updateVoxelClouds(dt) {
    const wrapLeft = this._orthoLeft - 2;
    const wrapRight = this._orthoRight + 2;

    // Tint based on time of day
    const tint = this._getCloudTint();

    for (const cloud of this._voxelClouds) {
      cloud.mesh.position.x += cloud.speed * dt;

      if (cloud.mesh.position.x > wrapRight) {
        cloud.mesh.position.x = wrapLeft;
      }

      // Apply tint via emissive color on the material
      if (cloud.mesh.material) {
        cloud.mesh.material.emissiveColor = tint;
      }
    }
  }

  // ---- Cloud tint based on time of day ----

  _getCloudTint() {
    const t = this._timeOfDay;

    // White at noon, orange at dawn/dusk, blue-gray at night
    if (t < 0.15) {
      // Night → dawn transition
      const f = t / 0.15;
      return Color3.Lerp(new Color3(0.4, 0.4, 0.6), new Color3(1.0, 0.7, 0.5), f);
    } else if (t < 0.3) {
      // Dawn → day
      const f = (t - 0.15) / 0.15;
      return Color3.Lerp(new Color3(1.0, 0.7, 0.5), new Color3(1, 1, 1), f);
    } else if (t < 0.7) {
      // Day
      return new Color3(1, 1, 1);
    } else if (t < 0.85) {
      // Day → dusk
      const f = (t - 0.7) / 0.15;
      return Color3.Lerp(new Color3(1, 1, 1), new Color3(1.0, 0.7, 0.5), f);
    } else {
      // Dusk → night
      const f = (t - 0.85) / 0.15;
      return Color3.Lerp(new Color3(1.0, 0.7, 0.5), new Color3(0.4, 0.4, 0.6), f);
    }
  }

}
