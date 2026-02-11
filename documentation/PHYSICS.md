# Physics Architecture Decisions

This document records the physics architecture decisions for Talon & Lance, specifically the evaluation of Babylon.js physics options against the game's rollback netcode requirements.

## Babylon.js Character Controller

The [Character Controller](https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController/) is a higher-level abstraction on top of Havok that provides a kinematic capsule for character movement with collision response:

- Collision-aware movement via `moveWithCollisions()` (slides along walls/floors)
- Ground/air detection via `checkSupport()`
- Platform riding on `ANIMATED` bodies (elevators, moving platforms)
- Configurable slope handling

**Not suitable for Talon & Lance.** It is designed for 3D first/third-person character controllers. In a 2D-style Joust game with flapping flight mechanics, characters spend most of their time airborne, and jousting collision logic (who has the higher lance) is entirely game-specific. The character controller would fight the design more than help it.

## Havok vs Custom Physics

The gameplay physics for Joust are straightforward:

- Gravity pulling players down
- Flap impulse pushing players up
- Horizontal movement with drag/friction
- Platform collision (land on top, block from sides)
- Player-player jousting (compare Y positions of lances)

This is well within "roll your own" territory — a few dozen lines of integer arithmetic per frame. Havok is designed for complex 3D rigid body simulations (stacking, ragdolls, joints, friction models). Using it for a 2D Joust game would be like using a bulldozer to plant a flower.

**Decision: Custom integer arithmetic for all gameplay physics.**

## Rollback Netcode Determinism Requirements

This is the critical constraint. The rollback engine (`imports/netcode/`) requires:

1. **Bit-exact determinism across all clients** — every browser (Chrome, Firefox, Safari) and every CPU must produce identical results given the same inputs.
2. **Microsecond save/restore** — game state must be serializable to a flat buffer for rollback snapshots, typically dozens of times per second.
3. **Compact state representation** — state is checksummed and exchanged between peers for desync detection.

### Why Havok Cannot Be Used for Gameplay Physics

Per the [Havok determinism discussion](https://forum.babylonjs.com/t/havok-determinism/55364) on the Babylon.js forum:

- Havok is deterministic in the sense that identical inputs produce identical outputs when launching the same simulation multiple times.
- However, determinism is **not guaranteed across different spatial locations** within a single simulation.
- **Cross-platform determinism (Chrome vs Firefox vs Safari, different CPUs) is not guaranteed** because Havok uses floating-point SIMD internally.

Even if Havok were perfectly deterministic, two additional problems remain:

- **Havok is a black box** — you cannot serialize its internal state to an `Int32Array` for rollback snapshots. The engine's internal state is complex and opaque.
- **No snapshot/restore API** — rollback requires saving and loading full physics state each frame, which Havok does not support.

### How the Existing Architecture Solves This

- **Integer arithmetic** (1/256th pixel units) — no floating point in game logic means bit-exact results on every platform.
- **Flat `Int32Array` serialization** — microsecond save/restore. Layout: `[frame, rngSeed, p0.x, p0.y, p0.vx, p0.vy, p0.state, ..., npc0.x, ...]`. Estimated ~200 integers = 800 bytes.
- **Seedable PRNG** (mulberry32) — deterministic randomness. The PRNG seed is part of serialized state; on rollback it restores to the exact frame value.
- **`SyncTestSession`** — forces rollbacks every frame during development and validates determinism via checksums. Catches non-determinism bugs without needing a network.
- **FNV-1a checksums** — runtime desync detection. Checksums exchanged every 60 frames (~1 second at 60fps). `DesyncDetected` event fires on mismatch.

## Voxel Destruction (Visual-Only Havok)

For visual effects like a knight exploding into voxels on death, Havok is the right tool:

- Spawn Havok rigid bodies for each voxel piece on player death.
- Let Havok handle tumbling, bouncing, and stacking naturally.
- This is purely cosmetic — it does not affect game state, so determinism does not matter.
- Each client can have slightly different debris physics and nobody cares.
- Havok is already bundled with Babylon.js, so there is no extra dependency.

An alternative is a simple custom particle system (random velocities + gravity), which is cheaper but less visually impressive. Since Havok is already present and voxel blocks tumbling off platforms is exactly what it excels at, Havok is the recommended approach for debris.

## Summary

| Concern | Decision |
|---------|----------|
| Character controller | Skip — wrong abstraction for Joust |
| Gameplay physics | Custom integer arithmetic (deterministic, rollback-compatible) |
| Rollback compatibility | Custom physics only — Havok cannot snapshot/restore |
| Voxel destruction | Havok for visual debris (non-deterministic is fine) |

The separation between deterministic game state (custom integer physics) and visual rendering (Havok for cosmetic effects) is the core architectural pattern.

## References

- [Babylon.js Character Controller docs](https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController/)
- [Havok determinism discussion (Babylon.js forum)](https://forum.babylonjs.com/t/havok-determinism/55364)
- [Using Havok and the Havok Plugin](https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin)
- [Cross-Platform Determinism in WebAssembly (Unity Discussions)](https://discussions.unity.com/t/cross-platform-determinism-in-unity-using-webassembly/1495296)
