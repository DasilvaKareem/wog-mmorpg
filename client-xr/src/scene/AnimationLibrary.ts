import * as THREE from "three";

/**
 * Pre-built AnimationClips for humanoid characters.
 * All clips use ROTATION ONLY — no position tracks.
 * This ensures animations work at any character scale (boss 1.4x, female 0.95x, etc).
 *
 * Bone names: Root, Hip, Spine, Chest, Neck, Head,
 *   L_Shoulder, L_Arm, L_Hand, R_Shoulder, R_Arm, R_Hand,
 *   L_Hip, L_Knee, L_Foot, R_Hip, R_Knee, R_Foot
 */

// ── Helpers ─────────────────────────────────────────────────────────

function quatTrack(
  boneName: string,
  times: number[],
  eulers: [number, number, number][],
): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const [x, y, z] of eulers) {
    e.set(x, y, z);
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(
    `${boneName}.quaternion`,
    times,
    values,
  );
}

// ── Walk Cycle ──────────────────────────────────────────────────────
// 0.6s loop — legs/arms swing in opposition, spine twists, head bobs

function createWalkClip(): THREE.AnimationClip {
  const d = 0.6;
  const h = d / 2;
  const q = d / 4;

  return new THREE.AnimationClip("walk", d, [
    // Legs swing forward/back
    quatTrack("L_Hip", [0, h, d], [
      [0.45, 0, 0],
      [-0.40, 0, 0],
      [0.45, 0, 0],
    ]),
    quatTrack("R_Hip", [0, h, d], [
      [-0.40, 0, 0],
      [0.45, 0, 0],
      [-0.40, 0, 0],
    ]),
    // Knees bend on back-swing
    quatTrack("L_Knee", [0, q, h, h + q, d], [
      [0.1, 0, 0],
      [0.0, 0, 0],
      [0.6, 0, 0],
      [0.2, 0, 0],
      [0.1, 0, 0],
    ]),
    quatTrack("R_Knee", [0, q, h, h + q, d], [
      [0.6, 0, 0],
      [0.2, 0, 0],
      [0.1, 0, 0],
      [0.0, 0, 0],
      [0.6, 0, 0],
    ]),
    // Arms counter-swing
    quatTrack("L_Shoulder", [0, h, d], [
      [-0.35, 0, 0.05],
      [0.30, 0, 0.05],
      [-0.35, 0, 0.05],
    ]),
    quatTrack("R_Shoulder", [0, h, d], [
      [0.30, 0, -0.05],
      [-0.35, 0, -0.05],
      [0.30, 0, -0.05],
    ]),
    // Elbows bend slightly on back-swing
    quatTrack("L_Arm", [0, h, d], [
      [-0.2, 0, 0],
      [-0.4, 0, 0],
      [-0.2, 0, 0],
    ]),
    quatTrack("R_Arm", [0, h, d], [
      [-0.4, 0, 0],
      [-0.2, 0, 0],
      [-0.4, 0, 0],
    ]),
    // Spine twist and bounce
    quatTrack("Spine", [0, q, h, h + q, d], [
      [0.02, 0.04, 0],
      [0.0, 0, 0],
      [0.02, -0.04, 0],
      [0.0, 0, 0],
      [0.02, 0.04, 0],
    ]),
    // Head stabilizes (counter-rotates to spine twist)
    quatTrack("Head", [0, h, d], [
      [0, -0.03, 0],
      [0, 0.03, 0],
      [0, -0.03, 0],
    ]),
  ]);
}

// ── Idle ────────────────────────────────────────────────────────────
// 4s loop — breathing, weight shift, head look-around, arm fidget

function createIdleClip(): THREE.AnimationClip {
  const d = 4.0;

  return new THREE.AnimationClip("idle", d, [
    // Breathing: chest expands
    quatTrack("Chest", [0, 1, 2, 3, d], [
      [0, 0, 0],
      [0.02, 0, 0],
      [0, 0, 0],
      [0.02, 0, 0],
      [0, 0, 0],
    ]),
    // Spine sway (weight shift)
    quatTrack("Spine", [0, 1, 2, 3, d], [
      [0, 0, 0.01],
      [0.01, 0, -0.01],
      [0, 0, 0.01],
      [0.01, 0, -0.01],
      [0, 0, 0.01],
    ]),
    // Head look-around with blinks (pitch nods)
    quatTrack("Head", [0, 0.8, 1.6, 2.4, 3.2, d], [
      [0, 0, 0],
      [0.05, 0.2, 0],
      [-0.03, -0.1, 0],
      [0.04, 0.15, 0],
      [-0.02, -0.2, 0],
      [0, 0, 0],
    ]),
    // Weight shift on hips
    quatTrack("Hip", [0, 2, d], [
      [0, 0, 0.015],
      [0, 0, -0.015],
      [0, 0, 0.015],
    ]),
    // Arms hang with subtle sway
    quatTrack("L_Shoulder", [0, 1.5, 3.0, d], [
      [0.03, 0, 0.06],
      [-0.02, 0, 0.03],
      [0.03, 0, 0.06],
      [0.03, 0, 0.06],
    ]),
    quatTrack("R_Shoulder", [0, 1.5, 3.0, d], [
      [0.03, 0, -0.06],
      [-0.02, 0, -0.03],
      [0.03, 0, -0.06],
      [0.03, 0, -0.06],
    ]),
    // Fingers/hands curl slightly
    quatTrack("L_Hand", [0, 2, d], [
      [0.1, 0, 0],
      [0.15, 0, 0],
      [0.1, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 2, d], [
      [0.1, 0, 0],
      [0.15, 0, 0],
      [0.1, 0, 0],
    ]),
  ]);
}

// ── Attack ──────────────────────────────────────────────────────────
// 0.55s one-shot — wind up → slash → impact → recover

function createAttackClip(): THREE.AnimationClip {
  const d = 0.55;

  return new THREE.AnimationClip("attack", d, [
    // Chest: lean back → whip forward → hold → return
    quatTrack("Chest", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.25, 0, 0.1],      // wind up: lean back + twist
      [-0.5, 0, -0.15],    // lunge forward + untwist
      [-0.3, 0, 0],        // impact hold
      [0, 0, 0],
    ]),
    // Right arm: raise → slash down hard
    quatTrack("R_Shoulder", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [-2.0, 0, -0.3],     // arm raised behind head
      [1.2, 0, 0.1],       // slash down past body
      [0.6, 0, 0],         // hold
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.22, d], [
      [0, 0, 0],
      [-0.8, 0, 0],        // elbow bent back
      [-0.2, 0, 0],        // extend on strike
      [0, 0, 0],
    ]),
    // Left arm: brace then pull back
    quatTrack("L_Shoulder", [0, 0.10, 0.22, d], [
      [0, 0, 0],
      [0.3, 0, -0.3],
      [-0.3, 0, -0.4],
      [0, 0, 0],
    ]),
    // Hips drive the lunge
    quatTrack("Hip", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.1, 0.1, 0],       // twist back
      [-0.15, -0.15, 0],   // drive forward
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Front leg braces, back leg pushes
    quatTrack("L_Hip", [0, 0.22, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.22, d], [
      [0, 0, 0],
      [-0.25, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Damage (hit reaction) ───────────────────────────────────────────
// 0.5s one-shot — snap back → stagger → recover

function createDamageClip(): THREE.AnimationClip {
  const d = 0.5;

  return new THREE.AnimationClip("damage", d, [
    // Chest jolts back
    quatTrack("Chest", [0, 0.06, 0.15, 0.30, d], [
      [0, 0, 0],
      [0.5, 0, 0.1],       // sharp jolt
      [0.3, 0, -0.08],     // stagger opposite
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
    // Head snaps
    quatTrack("Head", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [0.3, 0.2, 0],
      [0.1, -0.1, 0],
      [0, 0, 0],
    ]),
    // Arms fling out
    quatTrack("L_Shoulder", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [-0.6, 0, -0.5],
      [-0.15, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("R_Shoulder", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [-0.6, 0, 0.5],
      [-0.15, 0, 0.1],
      [0, 0, 0],
    ]),
    // Knees buckle slightly
    quatTrack("L_Knee", [0, 0.10, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.10, d], [
      [0, 0, 0],
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Heal ────────────────────────────────────────────────────────────
// 0.8s one-shot — arms raise, chest lifts, settle

function createHealClip(): THREE.AnimationClip {
  const d = 0.8;

  return new THREE.AnimationClip("heal", d, [
    // Arms spread up and out
    quatTrack("L_Shoulder", [0, 0.25, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, -0.6],
      [-0.9, 0, -0.45],
      [0, 0, 0],
    ]),
    quatTrack("R_Shoulder", [0, 0.25, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, 0.6],
      [-0.9, 0, 0.45],
      [0, 0, 0],
    ]),
    // Palms face up
    quatTrack("L_Hand", [0, 0.25, d], [
      [0, 0, 0],
      [-0.5, 0, 0.8],
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.25, d], [
      [0, 0, 0],
      [-0.5, 0, -0.8],
      [0, 0, 0],
    ]),
    // Chest rises
    quatTrack("Chest", [0, 0.25, 0.55, d], [
      [0, 0, 0],
      [-0.15, 0, 0],
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Head tilts up
    quatTrack("Head", [0, 0.25, d], [
      [0, 0, 0],
      [-0.25, 0, 0],
      [0, 0, 0],
    ]),
    // Slight float via hip extension
    quatTrack("Hip", [0, 0.25, 0.55, d], [
      [0, 0, 0],
      [-0.08, 0, 0],
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Death ───────────────────────────────────────────────────────────
// 1.5s one-shot — stagger → buckle → topple → lie still

function createDeathClip(): THREE.AnimationClip {
  const d = 1.5;

  return new THREE.AnimationClip("death", d, [
    // Hip tilts and falls (the main topple driver)
    quatTrack("Hip", [0, 0.35, 0.80, d], [
      [0, 0, 0],
      [0.2, 0, 0.25],      // stagger
      [0.3, 0, 1.45],      // topple sideways
      [0.25, 0, 1.57],     // lying on side
    ]),
    // Spine crumples
    quatTrack("Spine", [0, 0.35, 0.80, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.5, 0.1, 0],
      [0.4, 0.1, 0],
    ]),
    // Head droops
    quatTrack("Head", [0, 0.35, d], [
      [0, 0, 0],
      [0.4, 0.3, 0],
      [0.5, 0.2, 0],
    ]),
    // Arms flail then go limp
    quatTrack("L_Shoulder", [0, 0.25, 0.60, d], [
      [0, 0, 0],
      [-1.8, 0, -0.5],
      [-0.6, 0, -0.8],
      [-0.3, 0, -0.3],
    ]),
    quatTrack("R_Shoulder", [0, 0.25, 0.60, d], [
      [0, 0, 0],
      [-1.4, 0, 0.5],
      [-0.5, 0, 0.6],
      [-0.2, 0, 0.2],
    ]),
    // Knees buckle
    quatTrack("L_Knee", [0, 0.50, d], [
      [0, 0, 0],
      [0.8, 0, 0],
      [0.4, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.50, d], [
      [0, 0, 0],
      [0.6, 0, 0],
      [0.2, 0, 0],
    ]),
    // Legs splay
    quatTrack("L_Hip", [0, 0.50, d], [
      [0, 0, 0],
      [0.5, 0, 0.2],
      [0.3, 0, 0.1],
    ]),
    quatTrack("R_Hip", [0, 0.50, d], [
      [0, 0, 0],
      [-0.3, 0, -0.15],
      [-0.1, 0, -0.1],
    ]),
  ]);
}

// ── Gather ──────────────────────────────────────────────────────────
// 1.8s one-shot — bend down → reach → pull up → stand

function createGatherClip(): THREE.AnimationClip {
  const d = 1.8;

  return new THREE.AnimationClip("gather", d, [
    // Spine bends forward
    quatTrack("Spine", [0, 0.55, 0.90, 1.25, d], [
      [0, 0, 0],
      [-0.6, 0, 0],        // bending
      [-0.65, 0, 0],       // hold with wobble
      [-0.6, 0, 0],
      [0, 0, 0],           // stand up
    ]),
    quatTrack("Chest", [0, 0.55, 0.90, d], [
      [0, 0, 0],
      [-0.35, 0, 0],
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Right arm reaches down
    quatTrack("R_Shoulder", [0, 0.55, 0.72, 0.90, 1.25, d], [
      [0, 0, 0],
      [1.8, 0, 0],         // reaching down
      [1.9, 0, 0.1],       // wobble: pulling
      [1.7, 0, -0.1],      // wobble
      [0.3, 0, 0],         // pulling up with item
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.55, 0.90, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Left arm braces on knee
    quatTrack("L_Shoulder", [0, 0.55, 1.25, d], [
      [0, 0, 0],
      [0.6, 0, 0],
      [0.6, 0, 0],
      [0, 0, 0],
    ]),
    // Knees bend
    quatTrack("L_Knee", [0, 0.55, 1.25, d], [
      [0, 0, 0],
      [0.6, 0, 0],
      [0.6, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.55, 1.25, d], [
      [0, 0, 0],
      [0.5, 0, 0],
      [0.5, 0, 0],
      [0, 0, 0],
    ]),
    // Hips lower
    quatTrack("L_Hip", [0, 0.55, 1.25, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0.35, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.55, 1.25, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Craft ───────────────────────────────────────────────────────────
// 2.0s one-shot — rhythmic hammering with body involvement

function createCraftClip(): THREE.AnimationClip {
  const d = 2.0;

  // 4 hammer strikes
  const times: number[] = [];
  const rShoulderEulers: [number, number, number][] = [];
  const rArmEulers: [number, number, number][] = [];
  const chestEulers: [number, number, number][] = [];

  for (let i = 0; i < 4; i++) {
    const t = i * 0.5;
    // Raise
    times.push(t);
    rShoulderEulers.push([-1.6, 0, -0.2]);
    rArmEulers.push([-1.0, 0, 0]);
    chestEulers.push([-0.08, 0, 0]);
    // Strike
    times.push(t + 0.2);
    rShoulderEulers.push([0.5, 0, 0.1]);
    rArmEulers.push([-0.2, 0, 0]);
    chestEulers.push([-0.2, 0, 0]);
    // Bounce
    times.push(t + 0.35);
    rShoulderEulers.push([0.3, 0, 0]);
    rArmEulers.push([-0.3, 0, 0]);
    chestEulers.push([-0.12, 0, 0]);
  }

  return new THREE.AnimationClip("craft", d, [
    quatTrack("R_Shoulder", times, rShoulderEulers),
    quatTrack("R_Arm", times, rArmEulers),
    quatTrack("Chest", times, chestEulers),
    // Left arm braces steadily
    quatTrack("L_Shoulder", [0, d], [
      [0.4, 0, -0.15],
      [0.4, 0, -0.15],
    ]),
    quatTrack("L_Arm", [0, d], [
      [-0.5, 0, 0],
      [-0.5, 0, 0],
    ]),
    // Slight lean forward
    quatTrack("Spine", [0, d], [
      [-0.1, 0, 0],
      [-0.1, 0, 0],
    ]),
  ]);
}

// ── Library singleton ───────────────────────────────────────────────

export class AnimationLibrary {
  private static clips: Map<string, THREE.AnimationClip> | null = null;

  static get(name: string): THREE.AnimationClip {
    if (!this.clips) {
      this.clips = new Map();
      const all = [
        createWalkClip(),
        createIdleClip(),
        createAttackClip(),
        createDamageClip(),
        createHealClip(),
        createDeathClip(),
        createGatherClip(),
        createCraftClip(),
      ];
      for (const c of all) {
        this.clips.set(c.name, c);
      }
    }
    return this.clips.get(name)!;
  }

  static readonly LOOPING = new Set(["walk", "idle"]);
}
