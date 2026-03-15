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

// ── Attack (melee) ──────────────────────────────────────────────────
// 0.55s one-shot — wind up → slash → impact → recover
// Used by: warrior, paladin, monk, rogue, ranger

function createAttackClip(): THREE.AnimationClip {
  const d = 0.55;

  return new THREE.AnimationClip("attack", d, [
    // Chest: lean back → whip forward → hold → return
    quatTrack("Chest", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.3, 0, 0.15],       // wind up: lean back + twist
      [-0.55, 0, -0.2],     // lunge forward + untwist
      [-0.35, 0, -0.05],    // impact hold
      [0, 0, 0],
    ]),
    // Spine follows through
    quatTrack("Spine", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.1, 0.12, 0],       // twist with wind-up
      [-0.15, -0.15, 0],    // uncoil on strike
      [-0.08, -0.05, 0],
      [0, 0, 0],
    ]),
    // Right arm: raise → slash down hard
    quatTrack("R_Shoulder", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [-2.2, 0.2, -0.4],    // arm raised behind head, cocked out
      [1.3, -0.1, 0.15],    // slash down past body
      [0.7, 0, 0.05],       // hold
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [-1.0, 0, 0],         // elbow bent back
      [-0.15, 0, 0],        // extend on strike
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.10, 0.22, d], [
      [0, 0, 0],
      [-0.4, 0, -0.2],      // wrist cocked
      [0.3, 0, 0.1],        // wrist snap on impact
      [0, 0, 0],
    ]),
    // Left arm: shield brace / counter-balance
    quatTrack("L_Shoulder", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.35, 0, -0.35],     // pull back
      [-0.4, 0, -0.5],      // drive forward for balance
      [-0.2, 0, -0.25],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.10, 0.22, d], [
      [0, 0, 0],
      [-0.5, 0, 0],         // elbow guard
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Hips drive the lunge
    quatTrack("Hip", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.12, 0.12, 0],      // twist back
      [-0.18, -0.18, 0],    // drive forward
      [-0.06, -0.05, 0],
      [0, 0, 0],
    ]),
    // Head tracks target
    quatTrack("Head", [0, 0.10, 0.22, d], [
      [0, 0, 0],
      [0.05, 0.1, 0],       // glance up at target
      [-0.1, -0.08, 0],     // eyes follow strike
      [0, 0, 0],
    ]),
    // Front leg braces, back leg pushes
    quatTrack("L_Hip", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [-0.1, 0, 0],         // load weight back
      [0.4, 0, 0],          // lunge step
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.35, 0, 0],         // front knee bends on impact
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.10, 0.22, 0.35, d], [
      [0, 0, 0],
      [0.1, 0, 0],          // rear leg loads
      [-0.3, 0, 0],         // push off
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.22, d], [
      [0, 0, 0],
      [0.2, 0, 0],          // slight bend on push
      [0, 0, 0],
    ]),
    // Feet stay planted
    quatTrack("L_Foot", [0, 0.22, d], [
      [0, 0, 0],
      [-0.2, 0, 0],         // toe digs in
      [0, 0, 0],
    ]),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════
// WARRIOR ABILITY ANIMATIONS
// Each warrior technique gets a unique, dramatic animation.
// Ranked-up versions share the same clip as the base ability.
// ═══════════════════════════════════════════════════════════════════════

// ── Heroic Strike ──────────────────────────────────────────────────
// 0.7s — leap into massive overhead two-handed slam
// The warrior's signature move: big, brutal, satisfying

function createHeroicStrikeClip(): THREE.AnimationClip {
  const d = 0.7;

  return new THREE.AnimationClip("heroicstrike", d, [
    // Hips launch upward and forward then slam down
    quatTrack("Hip", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [0.15, 0.08, 0],        // coil back
      [-0.25, -0.1, 0],       // leap forward
      [-0.35, 0, 0],          // peak of jump, leaning in
      [-0.1, 0, 0],           // landing
      [0, 0, 0],
    ]),
    // Spine arches back for the wind-up, then snaps forward
    quatTrack("Spine", [0, 0.12, 0.28, 0.40, d], [
      [0, 0, 0],
      [0.25, 0, 0],           // arch back
      [0.35, 0, 0],           // peak arch — weapon high
      [-0.4, 0, 0],           // snap forward on slam
      [0, 0, 0],
    ]),
    // Chest drives the slam
    quatTrack("Chest", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [0.3, 0, 0],            // lean back
      [0.45, 0, 0],           // peak — chest opens up
      [-0.65, 0, 0],          // SLAM — chest crashes forward
      [-0.3, 0, 0],           // impact hold
      [0, 0, 0],
    ]),
    // Both arms raise high overhead then crash down together
    quatTrack("R_Shoulder", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.8, 0, -0.2],        // arm raised high
      [-2.6, 0, -0.15],       // peak — weapon overhead
      [1.4, 0, 0.1],          // SLAM down past body
      [0.8, 0, 0.05],         // impact hold
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.6, 0, 0.2],         // left arm follows for two-handed grip
      [-2.4, 0, 0.15],        // peak
      [1.2, 0, -0.1],         // SLAM
      [0.6, 0, -0.05],        // hold
      [0, 0, 0],
    ]),
    // Elbows lock straight on downswing
    quatTrack("R_Arm", [0, 0.12, 0.28, 0.40, d], [
      [0, 0, 0],
      [-1.2, 0, 0],           // bent back
      [-0.8, 0, 0],           // extending up
      [-0.05, 0, 0],          // LOCKED straight on impact
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.12, 0.28, 0.40, d], [
      [0, 0, 0],
      [-1.0, 0, 0],
      [-0.7, 0, 0],
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Wrists snap on impact
    quatTrack("R_Hand", [0, 0.28, 0.40, d], [
      [0, 0, 0],
      [-0.5, 0, -0.3],        // cocked back
      [0.6, 0, 0.2],          // SNAP forward
      [0, 0, 0],
    ]),
    // Head tracks down to impact point
    quatTrack("Head", [0, 0.12, 0.28, 0.40, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // look up at apex
      [-0.25, 0, 0],          // peak upward gaze
      [0.2, 0, 0],            // snap down watching impact
      [0, 0, 0],
    ]),
    // Legs: crouch → launch → land heavy
    quatTrack("L_Hip", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [0.3, 0, 0],            // crouch
      [-0.1, 0, 0],           // launch
      [0.5, 0, 0],            // forward lunge landing
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.12, 0.28, 0.40, 0.55, d], [
      [0, 0, 0],
      [0.5, 0, 0],            // deep crouch
      [0.1, 0, 0],            // legs extend in air
      [0.6, 0, 0],            // HEAVY land — knee absorbs
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.12, 0.28, 0.40, d], [
      [0, 0, 0],
      [0.25, 0, 0],           // crouch
      [-0.3, 0, 0],           // rear leg pushes off
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.12, 0.40, d], [
      [0, 0, 0],
      [0.4, 0, 0],            // deep crouch
      [0.15, 0, 0],           // trailing
      [0, 0, 0],
    ]),
    // Front foot slams flat
    quatTrack("L_Foot", [0, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.3, 0, 0],           // toe-first landing
      [0, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Cleave ─────────────────────────────────────────────────────────
// 0.65s — wide horizontal 360° sweep that hits multiple targets
// Body spins, weapon carves a full arc

function createCleaveClip(): THREE.AnimationClip {
  const d = 0.65;

  return new THREE.AnimationClip("cleave", d, [
    // Hip drives the spin — full 360° rotation via Y-axis
    quatTrack("Hip", [0, 0.10, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.05, 0.3, 0],         // wind up twist
      [-0.1, -3.14, 0],       // FULL SPIN through to 180°
      [-0.05, -6.0, 0],       // complete near-360
      [0, -6.28, 0],          // full rotation done
    ]),
    // Spine stays coiled — tight core
    quatTrack("Spine", [0, 0.10, 0.35, d], [
      [0, 0, 0],
      [0.1, 0.2, 0],          // wind up with hip
      [-0.15, -0.1, 0],       // lean into the sweep
      [0, 0, 0],
    ]),
    // Chest leans into the cut
    quatTrack("Chest", [0, 0.10, 0.25, 0.40, d], [
      [0, 0, 0],
      [0.15, 0, 0.1],         // wind back
      [-0.3, 0, -0.15],       // lean into sweep
      [-0.15, 0, 0],          // follow through
      [0, 0, 0],
    ]),
    // Weapon arm extends fully horizontal for max arc
    quatTrack("R_Shoulder", [0, 0.10, 0.25, 0.40, d], [
      [0, 0, 0],
      [-1.0, 0, -0.8],        // weapon arm cocked back
      [0.2, 0, -1.4],         // ARM FULLY OUT horizontal
      [0.1, 0, -0.6],         // follow through
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.25, d], [
      [0, 0, 0],
      [-0.6, 0, 0],           // bent during wind
      [-0.05, 0, 0],          // LOCKED STRAIGHT during sweep
      [0, 0, 0],
    ]),
    // Left arm counterbalances
    quatTrack("L_Shoulder", [0, 0.10, 0.25, 0.40, d], [
      [0, 0, 0],
      [0.2, 0, 0.5],          // pull back for balance
      [-0.1, 0, 0.8],         // arm out opposite side
      [0, 0, 0.3],
      [0, 0, 0],
    ]),
    // Head stays focused forward (counters spin)
    quatTrack("Head", [0, 0.10, 0.35, d], [
      [0, 0, 0],
      [0, -0.2, 0],           // counter-rotate
      [0, 0.15, 0],
      [0, 0, 0],
    ]),
    // Legs: wide stable stance
    quatTrack("L_Hip", [0, 0.15, 0.35, d], [
      [0, 0, 0],
      [0.15, 0, -0.15],       // widen stance
      [0.1, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.15, 0.35, d], [
      [0, 0, 0],
      [-0.1, 0, 0.15],        // widen stance
      [-0.05, 0, 0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.15, d], [
      [0, 0, 0],
      [0.3, 0, 0],            // low center of gravity
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.15, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Shield Wall ────────────────────────────────────────────────────
// 0.6s — slam shield forward, hunker into defensive stance
// Dramatic: shield bash forward then brace

function createShieldWallClip(): THREE.AnimationClip {
  const d = 0.6;

  return new THREE.AnimationClip("shieldwall", d, [
    // Left arm (shield arm) punches forward then braces
    quatTrack("L_Shoulder", [0, 0.12, 0.25, 0.40, d], [
      [0, 0, 0],
      [0.3, 0, 0.3],          // pull shield back
      [0.8, 0, -0.6],         // SLAM shield forward
      [0.5, 0, -0.5],         // brace — shield wall hold
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.12, 0.25, 0.40, d], [
      [0, 0, 0],
      [-0.8, 0, 0],           // arm cocked
      [-0.15, 0, 0],          // arm extended — shield out
      [-0.3, 0, 0],           // hold
      [0, 0, 0],
    ]),
    // Right arm pulls weapon back in guard
    quatTrack("R_Shoulder", [0, 0.25, 0.40, d], [
      [0, 0, 0],
      [-0.8, 0, -0.4],        // weapon raised in guard
      [-0.6, 0, -0.3],        // hold guard
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.25, d], [
      [0, 0, 0],
      [-0.7, 0, 0],           // elbow bent, weapon ready
      [0, 0, 0],
    ]),
    // Body hunkers down
    quatTrack("Chest", [0, 0.12, 0.25, 0.40, d], [
      [0, 0, 0],
      [0.15, 0, 0],           // draw back
      [-0.25, 0, 0],          // lean into shield
      [-0.2, 0, 0],           // hold
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.25, 0.40, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // compact stance
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Head peers over shield
    quatTrack("Head", [0, 0.25, 0.40, d], [
      [0, 0, 0],
      [0.15, 0, 0],           // chin tucked
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Knees bend deep — low center of gravity
    quatTrack("L_Knee", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [0.6, 0, 0],            // deep crouch
      [0.5, 0, 0],            // hold
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [0.5, 0, 0],
      [0.45, 0, 0],
      [0, 0, 0],
    ]),
    // Hips drop into the brace
    quatTrack("Hip", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [0.1, 0, 0],            // drop low
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
    // Front foot plants wide
    quatTrack("L_Hip", [0, 0.20, d], [
      [0, 0, 0],
      [0.3, 0, -0.2],         // forward and wide
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.20, d], [
      [0, 0, 0],
      [-0.2, 0, 0.15],        // back foot braces
      [0, 0, 0],
    ]),
  ]);
}

// ── Battle Rage ────────────────────────────────────────────────────
// 0.8s — flex power-up: arms wide, chest out, primal roar
// Body tenses and pulses with power

function createBattleRageClip(): THREE.AnimationClip {
  const d = 0.8;

  return new THREE.AnimationClip("battlerage", d, [
    // Arms fling wide then flex inward (power pose)
    quatTrack("R_Shoulder", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, -0.9],        // arm flung wide right
      [-0.8, 0, -1.2],        // PEAK spread
      [-0.4, 0, -0.3],        // flex inward — fists clenching
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, 0.9],         // arm flung wide left
      [-0.8, 0, 1.2],         // PEAK spread
      [-0.4, 0, 0.3],         // flex inward
      [0, 0, 0],
    ]),
    // Elbows flex — bicep curl pose
    quatTrack("R_Arm", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.4, 0, 0],
      [-1.4, 0, 0],           // TIGHT flex
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.4, 0, 0],
      [-1.4, 0, 0],           // TIGHT flex
      [0, 0, 0],
    ]),
    // Fists clench hard
    quatTrack("R_Hand", [0, 0.35, 0.55, d], [
      [0, 0, 0],
      [0.5, 0, 0],            // fist clenched
      [0.6, 0, 0],            // SQUEEZE
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.35, 0.55, d], [
      [0, 0, 0],
      [0.5, 0, 0],
      [0.6, 0, 0],
      [0, 0, 0],
    ]),
    // Chest EXPANDS — puffs up with rage
    quatTrack("Chest", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // chest lifts
      [-0.3, 0, 0],           // EXPANDED — roaring
      [-0.15, 0, 0],          // settling
      [0, 0, 0],
    ]),
    // Spine arches — back bows
    quatTrack("Spine", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.2, 0, 0],           // arched back
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Head tilts back for the ROAR then snaps forward
    quatTrack("Head", [0, 0.15, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.2, 0, 0],           // tilt back
      [-0.4, 0, 0],           // HEAD BACK — roaring at sky
      [0.15, 0, 0],           // snap forward aggressive
      [0, 0, 0],
    ]),
    // Knees bend with tension
    quatTrack("L_Knee", [0, 0.15, 0.35, d], [
      [0, 0, 0],
      [0.25, 0, 0],
      [0.35, 0, 0],           // legs tense
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.15, 0.35, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Feet widen for power stance
    quatTrack("L_Hip", [0, 0.15, d], [
      [0, 0, 0],
      [0.1, 0, -0.2],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.15, d], [
      [0, 0, 0],
      [-0.05, 0, 0.2],
      [0, 0, 0],
    ]),
  ]);
}

// ── Intimidating Shout ─────────────────────────────────────────────
// 0.7s — roar that shakes the earth: stomp + arms thrust down
// Pure aggression and dominance

function createIntimidatingShoutClip(): THREE.AnimationClip {
  const d = 0.7;

  return new THREE.AnimationClip("intimidatingshout", d, [
    // STOMP — hip drops hard
    quatTrack("Hip", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // rise up
      [0.2, 0, 0],            // STOMP DOWN
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Arms raise then SLAM down to sides — shockwave pose
    quatTrack("R_Shoulder", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-1.6, 0, -0.3],        // arms up
      [0.4, 0, -1.0],         // SLAM down and wide
      [0.2, 0, -0.6],         // hold wide
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-1.6, 0, 0.3],         // arms up
      [0.4, 0, 1.0],          // SLAM down and wide
      [0.2, 0, 0.6],          // hold wide
      [0, 0, 0],
    ]),
    // Arms lock straight for the slam
    quatTrack("R_Arm", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.05, 0, 0],          // straight
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Chest thrusts forward — aggressive bark
    quatTrack("Chest", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.2, 0, 0],           // expand upward
      [-0.45, 0, 0],          // THRUST forward — roar
      [-0.2, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.2, 0, 0],           // lean into shout
      [0, 0, 0],
    ]),
    // Head forward — IN YOUR FACE
    quatTrack("Head", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // slight back
      [0.2, 0, 0],            // JAW FORWARD
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Legs: power stomp — one foot SLAMS
    quatTrack("R_Hip", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.3, 0, 0],           // lift leg
      [0.2, 0, 0],            // STOMP
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [0.5, 0, 0],            // knee up high
      [0.1, 0, 0],            // SLAM flat
      [0, 0, 0],
    ]),
    quatTrack("R_Foot", [0, 0.30, d], [
      [0, 0, 0],
      [-0.3, 0, 0],           // toe stomp
      [0, 0, 0],
    ]),
    // Standing leg braces
    quatTrack("L_Knee", [0, 0.30, d], [
      [0, 0, 0],
      [0.3, 0, 0],            // absorb shock
      [0, 0, 0],
    ]),
  ]);
}

// ── Rallying Cry ───────────────────────────────────────────────────
// 0.75s — weapon raised high, triumphant war cry to inspire allies
// Heroic and commanding

function createRallyingCryClip(): THREE.AnimationClip {
  const d = 0.75;

  return new THREE.AnimationClip("rallyingcry", d, [
    // Right arm thrusts weapon SKYWARD
    quatTrack("R_Shoulder", [0, 0.15, 0.30, 0.50, d], [
      [0, 0, 0],
      [-0.5, 0, -0.2],        // draw back
      [-2.8, 0, -0.1],        // ARM STRAIGHT UP — weapon to sky
      [-2.6, 0, -0.1],        // hold high
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-0.05, 0, 0],          // fully extended
      [0, 0, 0],
    ]),
    // Left arm pumps fist
    quatTrack("L_Shoulder", [0, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.3, 0, -0.3],         // fist at side
      [-0.8, 0, -0.4],        // pump up
      [-0.6, 0, -0.3],        // hold
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.20, 0.35, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-1.2, 0, 0],           // tight fist pump
      [0, 0, 0],
    ]),
    // Chest expands — proud, commanding
    quatTrack("Chest", [0, 0.15, 0.30, 0.50, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.3, 0, 0],           // chest puffed out
      [-0.25, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.30, 0.50, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // tall posture
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Head tilts back for the cry
    quatTrack("Head", [0, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.35, 0, 0],          // HEAD BACK — crying to the heavens
      [-0.2, 0, 0],
      [0, 0, 0],
    ]),
    // Rise up tall
    quatTrack("Hip", [0, 0.15, 0.30, d], [
      [0, 0, 0],
      [-0.05, 0, 0],          // slight rise
      [-0.08, 0, 0],
      [0, 0, 0],
    ]),
    // Toes push up for height
    quatTrack("L_Foot", [0, 0.30, 0.50, d], [
      [0, 0, 0],
      [-0.35, 0, 0],          // on toes
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Foot", [0, 0.30, 0.50, d], [
      [0, 0, 0],
      [-0.35, 0, 0],
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Rending Strike ─────────────────────────────────────────────────
// 0.6s — vicious double slash: backhand then forehand rip
// Fast, brutal, leaves a wound

function createRendingStrikeClip(): THREE.AnimationClip {
  const d = 0.6;

  return new THREE.AnimationClip("rendingstrike", d, [
    // Two rapid slashes — first backhand right-to-left, then forehand left-to-right
    quatTrack("R_Shoulder", [0, 0.08, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [-0.8, 0.3, -0.5],      // wind up right
      [0.4, -0.2, 0.3],       // SLASH 1 — backhand right to left
      [-0.6, -0.2, -0.8],     // quick recoil left
      [0.5, 0.3, 0.2],        // SLASH 2 — forehand left to right
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.08, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [-0.7, 0, 0],           // cocked
      [-0.1, 0, 0],           // extended slash 1
      [-0.5, 0, 0],           // recoil
      [-0.1, 0, 0],           // extended slash 2
      [0, 0, 0],
    ]),
    // Wrist flicks on each cut
    quatTrack("R_Hand", [0, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [0.4, 0, 0.5],          // flick 1
      [-0.2, 0, -0.3],        // recoil
      [0.3, 0, -0.5],         // flick 2 opposite
      [0, 0, 0],
    ]),
    // Left arm guards/counterbalances
    quatTrack("L_Shoulder", [0, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [-0.3, 0, -0.5],        // guard during slash 1
      [-0.2, 0, 0.3],         // counterbalance
      [-0.3, 0, -0.4],        // guard during slash 2
      [0, 0, 0],
    ]),
    // Chest whips side to side driving each slash
    quatTrack("Chest", [0, 0.08, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [0.1, 0.2, 0.1],        // twist right
      [-0.2, -0.3, -0.1],     // WHIP left — slash 1
      [0.05, 0.15, 0.05],     // twist right
      [-0.15, -0.25, -0.05],  // WHIP left — slash 2
      [0, 0, 0],
    ]),
    // Spine coils and uncoils for each strike
    quatTrack("Spine", [0, 0.08, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [0, 0.15, 0],           // coil right
      [-0.1, -0.2, 0],        // uncoil left
      [0, 0.1, 0],            // coil right
      [-0.08, -0.15, 0],      // uncoil left
      [0, 0, 0],
    ]),
    // Head tracks aggressively
    quatTrack("Head", [0, 0.20, 0.44, d], [
      [0, 0, 0],
      [0.05, -0.15, 0],       // watch slash 1 impact
      [0.05, 0.1, 0],         // track slash 2
      [0, 0, 0],
    ]),
    // Hip drives forward
    quatTrack("Hip", [0, 0.12, 0.32, d], [
      [0, 0, 0],
      [-0.1, -0.1, 0],        // drive into slash 1
      [-0.12, 0.08, 0],       // drive into slash 2
      [0, 0, 0],
    ]),
    // Front foot steps into each slash
    quatTrack("L_Hip", [0, 0.12, 0.32, d], [
      [0, 0, 0],
      [0.3, 0, 0],            // step in
      [0.35, 0, 0],           // commit
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.12, 0.32, d], [
      [0, 0, 0],
      [0.25, 0, 0],           // bent — aggressive
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Spell Cast (mage) ───────────────────────────────────────────────
// 0.7s one-shot — gather energy → both arms thrust forward → release
// Used by: mage

function createSpellCastClip(): THREE.AnimationClip {
  const d = 0.7;

  return new THREE.AnimationClip("spellcast", d, [
    // Both arms sweep up and gather at center, then thrust forward
    quatTrack("R_Shoulder", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-1.6, 0, 0.5],       // arm raised wide right
      [-1.0, 0, -0.3],      // pull to center
      [0.8, 0, -0.1],       // thrust forward
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-1.6, 0, -0.5],      // arm raised wide left
      [-1.0, 0, 0.3],       // pull to center
      [0.8, 0, 0.1],        // thrust forward
      [0, 0, 0],
    ]),
    // Elbows extend on thrust
    quatTrack("R_Arm", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.9, 0, 0],         // bent while gathering
      [-0.7, 0, 0],         // pull in
      [-0.1, 0, 0],         // extend on release
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.9, 0, 0],
      [-0.7, 0, 0],
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Wrists flare open on release
    quatTrack("R_Hand", [0, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.3, 0, -0.4],      // cupped
      [0.4, 0, 0.3],        // flare open
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.30, 0.45, d], [
      [0, 0, 0],
      [-0.3, 0, 0.4],
      [0.4, 0, -0.3],
      [0, 0, 0],
    ]),
    // Chest draws back then punches forward
    quatTrack("Chest", [0, 0.15, 0.30, 0.45, d], [
      [0, 0, 0],
      [0.2, 0, 0],          // lean back gathering
      [0.1, 0, 0],          // hold
      [-0.4, 0, 0],         // thrust forward on release
      [0, 0, 0],
    ]),
    // Spine coils and uncoils
    quatTrack("Spine", [0, 0.15, 0.45, d], [
      [0, 0, 0],
      [0.1, 0, 0],          // slight lean back
      [-0.2, 0, 0],         // drive forward
      [0, 0, 0],
    ]),
    // Head focuses on target
    quatTrack("Head", [0, 0.15, 0.45, d], [
      [0, 0, 0],
      [-0.1, 0, 0],         // look up while gathering
      [-0.15, 0, 0],        // focus forward on release
      [0, 0, 0],
    ]),
    // Slight forward weight shift in hips
    quatTrack("Hip", [0, 0.30, 0.45, d], [
      [0, 0, 0],
      [0.05, 0, 0],
      [-0.1, 0, 0],         // lean into cast
      [0, 0, 0],
    ]),
    // Front knee bends on thrust
    quatTrack("L_Hip", [0, 0.45, d], [
      [0, 0, 0],
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.45, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Dark Cast (warlock) ─────────────────────────────────────────────
// 0.8s one-shot — one arm reaches toward target to drain, body leans in
// Used by: warlock

function createDarkCastClip(): THREE.AnimationClip {
  const d = 0.8;

  return new THREE.AnimationClip("darkcast", d, [
    // Right arm reaches forward (drain gesture), fingers spread
    quatTrack("R_Shoulder", [0, 0.12, 0.30, 0.55, d], [
      [0, 0, 0],
      [-0.8, 0, -0.3],      // lift arm
      [0.6, 0, -0.2],       // thrust forward toward target
      [0.5, 0, -0.15],      // hold drain
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.12, 0.30, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, 0],         // bent during lift
      [-0.1, 0, 0],         // extend to drain
      [-0.15, 0, 0],        // hold
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.30, 0.55, d], [
      [0, 0, 0],
      [0.5, 0, -0.3],       // fingers spread, clawing
      [0.4, 0, -0.25],      // sustain
      [0, 0, 0],
    ]),
    // Left arm pulls energy back toward body
    quatTrack("L_Shoulder", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, -0.6],      // arm rises to side
      [0.2, 0, -0.4],       // pull toward chest
      [0.3, 0, -0.3],       // hold
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [-0.4, 0, 0],
      [-0.7, 0, 0],         // elbow tight to body
      [0, 0, 0],
    ]),
    // Body leans forward menacingly
    quatTrack("Chest", [0, 0.12, 0.30, 0.55, d], [
      [0, 0, 0],
      [0.15, 0, 0],         // slight pull back
      [-0.35, 0, -0.08],    // lean into drain
      [-0.3, 0, -0.05],     // hold
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.30, 0.55, d], [
      [0, 0, 0],
      [-0.15, -0.08, 0],    // twist into drain
      [-0.12, -0.05, 0],
      [0, 0, 0],
    ]),
    // Head tilts down — sinister focus
    quatTrack("Head", [0, 0.30, 0.55, d], [
      [0, 0, 0],
      [0.15, -0.1, 0],      // chin down, slight turn
      [0.1, -0.08, 0],
      [0, 0, 0],
    ]),
    // Hips shift weight forward
    quatTrack("Hip", [0, 0.30, d], [
      [0, 0, 0],
      [-0.1, -0.05, 0],
      [0, 0, 0],
    ]),
    // Front leg forward, rear braces
    quatTrack("R_Hip", [0, 0.30, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Hip", [0, 0.30, d], [
      [0, 0, 0],
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.30, d], [
      [0, 0, 0],
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Holy Cast (cleric) ──────────────────────────────────────────────
// 0.75s one-shot — arms raise to sky → sweep down releasing radiance
// Used by: cleric

function createHolyCastClip(): THREE.AnimationClip {
  const d = 0.75;

  return new THREE.AnimationClip("holycast", d, [
    // Both arms raise high, palms up — invoking
    quatTrack("R_Shoulder", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.8, 0, 0.4],       // arm high and wide right
      [-2.0, 0, 0.3],       // peak — reaching skyward
      [-0.3, 0, 0.15],      // sweep down releasing
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.8, 0, -0.4],      // arm high and wide left
      [-2.0, 0, -0.3],      // peak
      [-0.3, 0, -0.15],     // sweep down
      [0, 0, 0],
    ]),
    // Elbows extend reaching up
    quatTrack("R_Arm", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.2, 0, 0],         // fully extended above
      [-0.4, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.2, 0, 0],
      [-0.4, 0, 0],
      [0, 0, 0],
    ]),
    // Palms face up then push outward
    quatTrack("R_Hand", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, 0.5],       // palm upward
      [-0.8, 0, 0.6],       // fully open to sky
      [0.2, 0, -0.2],       // push light outward
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, -0.5],
      [-0.8, 0, -0.6],
      [0.2, 0, 0.2],
      [0, 0, 0],
    ]),
    // Chest lifts up during invocation, then settles
    quatTrack("Chest", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.15, 0, 0],        // chest lifts
      [-0.25, 0, 0],        // peak lift
      [-0.1, 0, 0],         // settle
      [0, 0, 0],
    ]),
    // Spine arches back slightly
    quatTrack("Spine", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.15, 0, 0],        // slight arch
      [0, 0, 0],
    ]),
    // Head tilts up to sky then forward to target
    quatTrack("Head", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.2, 0, 0],         // look up
      [-0.35, 0, 0],        // gaze skyward
      [0.05, 0, 0],         // look at target
      [0, 0, 0],
    ]),
    // Slight rise on toes via hip tilt
    quatTrack("Hip", [0, 0.20, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.06, 0, 0],        // rise
      [-0.1, 0, 0],         // peak
      [-0.03, 0, 0],
      [0, 0, 0],
    ]),
    // Feet press — rise onto toes
    quatTrack("L_Foot", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.4, 0, 0],         // toes pointed
      [0, 0, 0],
    ]),
    quatTrack("R_Foot", [0, 0.20, 0.40, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.4, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Damage (hit reaction) ───────────────────────────────────────────
// 0.5s one-shot — snap back → stagger → recover

function createDamageClip(): THREE.AnimationClip {
  const d = 0.5;

  return new THREE.AnimationClip("damage", d, [
    // Chest jolts back hard then staggers
    quatTrack("Chest", [0, 0.06, 0.15, 0.30, d], [
      [0, 0, 0],
      [0.55, 0.08, 0.15],   // sharp jolt back + twist
      [0.35, -0.05, -0.12], // stagger opposite direction
      [0.1, 0, 0.03],
      [0, 0, 0],
    ]),
    // Spine absorbs impact
    quatTrack("Spine", [0, 0.06, 0.15, 0.30, d], [
      [0, 0, 0],
      [0.25, 0, 0.1],       // compressed on impact
      [0.15, 0, -0.05],     // stagger follow-through
      [0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Head snaps back then whips
    quatTrack("Head", [0, 0.06, 0.15, 0.25, d], [
      [0, 0, 0],
      [0.4, 0.25, 0.1],     // snap back and sideways
      [0.15, -0.15, -0.05], // recoil opposite
      [0.05, -0.05, 0],
      [0, 0, 0],
    ]),
    // Arms fling out with recoil
    quatTrack("L_Shoulder", [0, 0.06, 0.15, 0.25, d], [
      [0, 0, 0],
      [-0.7, 0.1, -0.6],    // flung backward
      [-0.3, 0, -0.2],      // pull in slightly
      [-0.1, 0, -0.05],
      [0, 0, 0],
    ]),
    quatTrack("R_Shoulder", [0, 0.06, 0.15, 0.25, d], [
      [0, 0, 0],
      [-0.7, -0.1, 0.6],    // flung backward
      [-0.3, 0, 0.2],
      [-0.1, 0, 0.05],
      [0, 0, 0],
    ]),
    // Hands go limp on impact
    quatTrack("L_Hand", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [0.3, 0, 0.2],
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [0.3, 0, -0.2],
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Hips stagger back
    quatTrack("Hip", [0, 0.06, 0.15, 0.30, d], [
      [0, 0, 0],
      [0.15, 0.05, 0.08],   // rocked back
      [0.08, -0.03, -0.05], // stagger
      [0.02, 0, 0],
      [0, 0, 0],
    ]),
    // Knees buckle on impact
    quatTrack("L_Knee", [0, 0.06, 0.15, d], [
      [0, 0, 0],
      [0.4, 0, 0],          // buckle
      [0.15, 0, 0],         // recovering
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.06, 0.15, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0.12, 0, 0],
      [0, 0, 0],
    ]),
    // Hips absorb the stagger
    quatTrack("L_Hip", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [-0.15, 0, 0.05],     // weight shift
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.06, 0.20, d], [
      [0, 0, 0],
      [-0.1, 0, -0.05],
      [-0.03, 0, 0],
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
        createHeroicStrikeClip(),
        createCleaveClip(),
        createShieldWallClip(),
        createBattleRageClip(),
        createIntimidatingShoutClip(),
        createRallyingCryClip(),
        createRendingStrikeClip(),
        createSpellCastClip(),
        createDarkCastClip(),
        createHolyCastClip(),
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
