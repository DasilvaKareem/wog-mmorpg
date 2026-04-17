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
  // 0.60s — hip-driven slash with snap, overshoot, and impact hold
  // 0–0.12 wind-up | 0.12–0.18 STRIKE | 0.18–0.22 impact hold | 0.22–0.40 follow-through | 0.40–0.60 recover
  const d = 0.60;

  return new THREE.AnimationClip("attack", d, [
    // ── Hips lead — twist back then EXPLODE forward ──
    quatTrack("Hip", [0, 0.06, 0.12, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.08, 0.25, 0],        // hips twist back (load)
      [0.12, 0.35, 0.05],     // fully coiled
      [-0.15, -0.40, -0.05],  // EXPLODE forward
      [-0.12, -0.30, 0],      // impact hold
      [-0.05, -0.10, 0],      // follow-through
      [0, 0, 0],
    ]),
    // ── Spine follows hips with delay ──
    quatTrack("Spine", [0, 0.08, 0.14, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.05, 0.18, 0],        // coils after hips
      [0.10, 0.25, 0],        // fully wound
      [-0.12, -0.25, 0],      // uncoil
      [-0.08, -0.15, 0],      // hold
      [-0.03, -0.05, 0],
      [0, 0, 0],
    ]),
    // ── Chest whips last — slow wind, FAST snap ──
    quatTrack("Chest", [0, 0.10, 0.14, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.25, 0.15, 0.10],     // lean back, chest opens
      [0.40, 0.20, 0.15],     // fully wound
      [-0.50, -0.25, -0.15],  // SNAP forward
      [-0.35, -0.15, -0.05],  // impact overshoot
      [-0.10, -0.05, 0],
      [0, 0, 0],
    ]),
    // ── Right arm: slow raise → FAST slash → overshoot → recoil ──
    quatTrack("R_Shoulder", [0, 0.08, 0.14, 0.18, 0.22, 0.35, d], [
      [0, 0, 0],
      [-1.2, 0.15, -0.2],     // arm begins lifting
      [-2.4, 0.25, -0.5],     // fully raised behind head
      [1.5, -0.15, 0.20],     // SLASH — overshoot past body
      [0.9, -0.05, 0.10],     // recoil
      [0.3, 0, 0.05],         // settle
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.14, 0.18, 0.22, d], [
      [0, 0, 0],
      [-0.6, 0, 0],           // elbow bending
      [-1.2, 0, 0],           // fully cocked
      [-0.1, 0, 0],           // EXTENDS on strike
      [-0.15, 0, 0],          // slight recoil
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.14, 0.18, 0.22, d], [
      [0, 0, 0],
      [-0.5, 0, -0.3],        // wrist cocked
      [0.4, 0, 0.2],          // wrist SNAP
      [0.2, 0, 0.1],          // settle
      [0, 0, 0],
    ]),
    // ── Left arm counter-balance — pulls back for torque ──
    quatTrack("L_Shoulder", [0, 0.10, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.4, 0, -0.4],         // pull back
      [-0.5, 0, -0.6],        // drive forward
      [-0.3, 0, -0.35],       // hold
      [-0.1, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.10, 0.18, 0.40, d], [
      [0, 0, 0],
      [-0.6, 0, 0],           // guard
      [-0.35, 0, 0],          // brace
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // ── Head tracks target, snaps down on impact ──
    quatTrack("Head", [0, 0.10, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.08, 0.12, 0],        // eyes up tracking
      [-0.15, -0.10, 0],      // snap down with strike
      [-0.10, -0.05, 0],      // aggressive hold
      [-0.03, 0, 0],
      [0, 0, 0],
    ]),
    // ── Front leg: braces for impact ──
    quatTrack("L_Hip", [0, 0.10, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // load weight back
      [0.50, 0, 0],           // LUNGE forward
      [0.35, 0, 0],           // brace
      [0.10, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.12, 0.18, 0.22, 0.40, d], [
      [0, 0, 0],
      [0.1, 0, 0],
      [0.45, 0, 0],           // deep bend on lunge
      [0.35, 0, 0],           // brace hold
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // ── Rear leg: pushes off ──
    quatTrack("R_Hip", [0, 0.08, 0.18, 0.22, d], [
      [0, 0, 0],
      [0.20, 0, 0],           // load
      [-0.15, 0, 0],          // push off
      [-0.08, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.08, 0.18, 0.22, d], [
      [0, 0, 0],
      [0.50, 0, 0],           // deeply bent — power loaded
      [0.10, 0, 0],           // extends
      [0.05, 0, 0],
      [0, 0, 0],
    ]),
    // ── Front foot digs in ──
    quatTrack("L_Foot", [0, 0.18, 0.22, d], [
      [0, 0, 0],
      [-0.25, 0, 0],          // toe digs in on impact
      [-0.1, 0, 0],
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
  // MASSIVE overhead slam — warrior jumps, weapon crashes down with full body weight
  // 0-0.15 crouch+wind | 0.15-0.30 LEAP UP | 0.30-0.36 SLAM | 0.36-0.42 impact freeze | 0.42-0.70 recover
  const d = 0.70;

  return new THREE.AnimationClip("heroicstrike", d, [
    // Hips: deep crouch → LAUNCH → crash forward
    quatTrack("Hip", [0, 0.10, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [0.20, 0.10, 0],          // crouch loading
      [0.25, 0.12, 0],          // deep coil
      [-0.15, -0.08, 0],        // airborne — hips forward
      [-0.45, 0, 0],            // CRASH DOWN — hips slam
      [-0.35, 0, 0],            // impact freeze
      [0, 0, 0],
    ]),
    // Spine: arches HARD back then WHIPS forward
    quatTrack("Spine", [0, 0.12, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [0.35, 0, 0],             // arch back hard
      [0.50, 0, 0],             // peak — fully extended
      [-0.55, 0, 0],            // WHIP forward
      [-0.30, 0, 0],            // hold
      [0, 0, 0],
    ]),
    // Chest: opens wide then CRASHES
    quatTrack("Chest", [0, 0.12, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [0.40, 0, 0.05],          // chest OPENS — warrior roar
      [0.60, 0, 0.05],          // peak — max extension
      [-0.80, 0, -0.05],        // SLAM — chest drives weapon down
      [-0.45, 0, 0],            // impact freeze
      [0, 0, 0],
    ]),
    // BOTH arms raise FULL overhead then CRASH down
    quatTrack("R_Shoulder", [0, 0.10, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [-1.5, 0, -0.2],          // lifting
      [-2.0, 0, -0.2],          // rising
      [-2.8, 0, -0.15],         // FULL OVERHEAD — weapon at zenith
      [1.8, 0, 0.15],           // CRASH DOWN — massive overshoot
      [1.0, 0, 0.08],           // impact hold
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.10, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [-1.3, 0, 0.2],           // two-hand grip follows
      [-1.8, 0, 0.2],
      [-2.6, 0, 0.15],          // overhead
      [1.5, 0, -0.12],          // CRASH
      [0.8, 0, -0.05],
      [0, 0, 0],
    ]),
    // Elbows: bent → SNAP straight on slam
    quatTrack("R_Arm", [0, 0.15, 0.30, 0.36, d], [
      [0, 0, 0],
      [-1.3, 0, 0],             // deeply bent
      [-0.6, 0, 0],             // extending
      [-0.02, 0, 0],            // LOCKED STRAIGHT
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.15, 0.30, 0.36, d], [
      [0, 0, 0],
      [-1.1, 0, 0],
      [-0.5, 0, 0],
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Wrists SNAP hard on impact
    quatTrack("R_Hand", [0, 0.30, 0.34, 0.36, d], [
      [0, 0, 0],
      [-0.6, 0, -0.4],          // cocked
      [-0.6, 0, -0.4],          // HOLD (micro-pause at apex)
      [0.8, 0, 0.3],            // SNAP
      [0, 0, 0],
    ]),
    // Head: looks up at weapon → SNAPS down to impact
    quatTrack("Head", [0, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [-0.20, 0, 0],            // look up
      [-0.35, 0, 0],            // watching weapon at peak
      [0.25, 0, 0],             // SNAP down — watching impact
      [0.15, 0, 0],             // hold
      [0, 0, 0],
    ]),
    // Legs: DEEP crouch → launch → HEAVY landing
    quatTrack("L_Hip", [0, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [0.40, 0, 0],             // deep squat
      [-0.15, 0, 0],            // launch
      [0.60, 0, 0],             // HEAVY forward lunge
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.15, 0.30, 0.36, 0.42, d], [
      [0, 0, 0],
      [0.70, 0, 0],             // DEEP squat
      [0.10, 0, 0],             // extend in air
      [0.80, 0, 0],             // CRASH — knee absorbs
      [0.30, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.15, 0.30, 0.36, d], [
      [0, 0, 0],
      [0.35, 0, 0],             // squat
      [-0.35, 0, 0],            // push off HARD
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.15, 0.36, d], [
      [0, 0, 0],
      [0.55, 0, 0],             // deep bend
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Foot", [0, 0.36, 0.42, d], [
      [0, 0, 0],
      [-0.40, 0, 0],            // toe SLAMS down
      [-0.10, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Cleave ─────────────────────────────────────────────────────────
// 0.65s — wide horizontal 360° sweep that hits multiple targets
// Body spins, weapon carves a full arc

function createCleaveClip(): THREE.AnimationClip {
  // VIOLENT 360° spin slash — weapon arm fully extended, cuts everything around
  // 0-0.10 wind | 0.10-0.15 COIL | 0.15-0.35 SPIN | 0.35-0.45 impact | 0.45-0.60 recover
  const d = 0.60;

  return new THREE.AnimationClip("cleave", d, [
    // Hip: EXPLOSIVE full rotation
    quatTrack("Hip", [0, 0.08, 0.15, 0.25, 0.35, 0.45, d], [
      [0, 0, 0],
      [0.08, 0.40, 0],          // wind up twist
      [0.10, 0.60, 0],          // deep coil
      [-0.08, -2.00, 0],        // SPINNING — halfway
      [-0.05, -4.50, 0],        // blast through
      [-0.03, -6.10, 0],        // near complete
      [0, -6.28, 0],            // full 360
    ]),
    // Chest: LEANS hard into the sweep
    quatTrack("Chest", [0, 0.10, 0.15, 0.25, 0.35, d], [
      [0, 0, 0],
      [0.20, 0.10, 0.15],       // wind back
      [0.25, 0.12, 0.18],       // coiled
      [-0.40, -0.05, -0.20],    // DRIVING into spin
      [-0.20, 0, -0.08],        // follow through
      [0, 0, 0],
    ]),
    // Spine stays tight for power transfer
    quatTrack("Spine", [0, 0.10, 0.25, 0.35, d], [
      [0, 0, 0],
      [0.12, 0.15, 0],
      [-0.18, -0.12, 0],        // lean into sweep
      [-0.06, -0.04, 0],
      [0, 0, 0],
    ]),
    // Weapon arm: FULLY EXTENDED horizontal — max killing arc
    quatTrack("R_Shoulder", [0, 0.10, 0.15, 0.25, 0.35, d], [
      [0, 0, 0],
      [-1.2, 0, -0.6],          // cocked back
      [-1.0, 0, -1.0],          // starting to extend
      [0.3, 0, -1.57],          // FULLY HORIZONTAL — arm straight out
      [0.15, 0, -0.8],          // follow through
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.15, 0.25, d], [
      [0, 0, 0],
      [-0.8, 0, 0],             // bent
      [-0.4, 0, 0],             // extending
      [-0.02, 0, 0],            // LOCKED STRAIGHT
      [0, 0, 0],
    ]),
    // Left arm: fist pulled in tight for centrifugal balance
    quatTrack("L_Shoulder", [0, 0.10, 0.25, 0.35, d], [
      [0, 0, 0],
      [0.3, 0, 0.4],            // pull in
      [-0.2, 0, 0.9],           // arm out for balance
      [-0.1, 0, 0.4],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.10, 0.25, d], [
      [0, 0, 0],
      [-0.9, 0, 0],             // tight fist at chest
      [-0.4, 0, 0],
      [0, 0, 0],
    ]),
    // Head: counter-rotates to stay locked on — warrior stare
    quatTrack("Head", [0, 0.10, 0.25, 0.35, d], [
      [0, 0, 0],
      [0.05, -0.25, 0],         // counter-rotate
      [-0.10, 0.20, 0],         // snap around
      [-0.05, 0.10, 0],
      [0, 0, 0],
    ]),
    // Legs: WIDE stance, low center of gravity for stability during spin
    quatTrack("L_Hip", [0, 0.10, 0.25, 0.35, d], [
      [0, 0, 0],
      [0.20, 0, -0.20],         // widen
      [0.15, 0, -0.15],         // hold wide
      [0.08, 0, -0.08],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.10, 0.25, 0.35, d], [
      [0, 0, 0],
      [-0.15, 0, 0.20],         // widen opposite
      [-0.10, 0, 0.15],
      [-0.05, 0, 0.08],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.10, 0.25, d], [
      [0, 0, 0],
      [0.45, 0, 0],             // deep bend — LOW
      [0.35, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.10, 0.25, d], [
      [0, 0, 0],
      [0.45, 0, 0],
      [0.35, 0, 0],
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
    // Two BRUTAL slashes — backhand then forehand RIP
    quatTrack("R_Shoulder", [0, 0.08, 0.20, 0.32, 0.44, d], [
      [0, 0, 0],
      [-1.2, 0.4, -0.7],      // wind up right — BIG
      [0.6, -0.3, 0.5],       // SLASH 1 — violent backhand
      [-0.9, -0.3, -1.0],     // quick recoil — cocking for second
      [0.7, 0.4, 0.4],        // SLASH 2 — forehand RIP
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
// ── Mage Spellcast ──────────────────────────────────────────────────
// 0.70s — gather wide → compress inward → SNAP release → recoil
// 0-0.18 gather | 0.18-0.30 charge | 0.30-0.36 RELEASE | 0.36-0.55 follow-through | 0.55-0.70 settle

function createSpellCastClip(): THREE.AnimationClip {
  const d = 0.70;

  return new THREE.AnimationClip("spellcast", d, [
    // Right arm: sweeps wide → pulls to center → SNAPS forward
    quatTrack("R_Shoulder", [0, 0.10, 0.18, 0.30, 0.36, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, 0.6],         // arm sweeps wide right
      [-1.6, 0, 0.4],         // peak gather
      [-0.8, 0, -0.2],        // compress to center (energy cupped)
      [0.9, 0, -0.15],        // SNAP forward — release
      [0.3, 0, 0],            // recoil drift
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.10, 0.18, 0.30, 0.36, 0.55, d], [
      [0, 0, 0],
      [-1.2, 0, -0.6],        // mirror wide left
      [-1.6, 0, -0.4],
      [-0.8, 0, 0.2],         // compress center
      [0.5, 0, 0.1],          // stabilize (left stays back)
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Elbows: bent during gather → EXTEND on release
    quatTrack("R_Arm", [0, 0.18, 0.30, 0.36, 0.55, d], [
      [0, 0, 0],
      [-1.0, 0, 0],           // deeply bent gathering
      [-0.8, 0, 0],           // compressed
      [-0.05, 0, 0],          // FULLY extended — snap
      [-0.2, 0, 0],           // settle
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.18, 0.30, 0.36, d], [
      [0, 0, 0],
      [-1.0, 0, 0],
      [-0.8, 0, 0],
      [-0.3, 0, 0],           // left stays more bent (asymmetry)
      [0, 0, 0],
    ]),
    // Wrists: cup energy → SNAP open on release
    quatTrack("R_Hand", [0, 0.18, 0.30, 0.34, 0.36, 0.55, d], [
      [0, 0, 0],
      [-0.2, 0, -0.3],        // fingers curling
      [-0.4, 0, -0.5],        // cupped — holding energy
      [-0.4, 0, -0.5],        // HOLD (micro-pause before release)
      [0.6, 0, 0.4],          // SNAP — palm bursts open
      [0.2, 0, 0.1],          // drift
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.18, 0.30, 0.36, d], [
      [0, 0, 0],
      [-0.2, 0, 0.3],
      [-0.4, 0, 0.5],         // cupped mirror
      [0.3, 0, -0.2],         // open stabilize
      [0, 0, 0],
    ]),
    // Chest: draws back → compresses → PUNCHES forward → recoil
    quatTrack("Chest", [0, 0.12, 0.30, 0.36, 0.42, 0.55, d], [
      [0, 0, 0],
      [0.20, 0, 0],           // lean back — energy gathering
      [0.15, 0, 0],           // compressed
      [-0.45, 0, 0],          // THRUST forward
      [0.08, 0, 0],           // recoil back
      [0.02, 0, 0],
      [0, 0, 0],
    ]),
    // Spine follows chest
    quatTrack("Spine", [0, 0.14, 0.30, 0.36, 0.55, d], [
      [0, 0, 0],
      [0.08, 0, 0],
      [0.05, 0, 0],
      [-0.20, 0, 0],          // drive forward
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Head: looks at hands → snaps to target on release
    quatTrack("Head", [0, 0.18, 0.30, 0.36, 0.55, d], [
      [0, 0, 0],
      [-0.10, -0.08, 0],      // watching hands gather
      [-0.05, 0, 0],          // look up at energy
      [-0.18, 0.05, 0],       // SNAP gaze to target
      [-0.08, 0, 0],
      [0, 0, 0],
    ]),
    // Hips: slight weight shift forward on release
    quatTrack("Hip", [0, 0.18, 0.36, 0.55, d], [
      [0, 0, 0],
      [0.06, 0, 0],           // weight back
      [-0.12, 0, 0],          // lean into cast
      [-0.04, 0, 0],
      [0, 0, 0],
    ]),
    // Front leg braces
    quatTrack("L_Hip", [0, 0.36, 0.55, d], [
      [0, 0, 0],
      [0.30, 0, 0],           // lunge
      [0.10, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.36, 0.55, d], [
      [0, 0, 0],
      [0.25, 0, 0],
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Dark Cast (warlock) ─────────────────────────────────────────────
// 0.80s — right hand claws forward to drain, left pulls energy inward
// 0-0.15 crouch | 0.15-0.30 reach | 0.30-0.38 CLAW | 0.38-0.55 drain hold | 0.55-0.80 release

function createDarkCastClip(): THREE.AnimationClip {
  const d = 0.80;

  return new THREE.AnimationClip("darkcast", d, [
    // Right arm: coils → CLAWS forward → holds drain
    quatTrack("R_Shoulder", [0, 0.10, 0.15, 0.30, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, -0.2],        // arm tucks close
      [-1.0, 0, -0.4],        // cocked back
      [-0.6, 0, -0.3],        // gathering dark energy
      [0.7, 0, -0.2],         // CLAW forward — aggressive thrust
      [0.6, 0, -0.15],        // drain hold
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.15, 0.30, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.8, 0, 0],           // elbow bent tight
      [-0.5, 0, 0],           // loosening
      [-0.08, 0, 0],          // EXTEND — reaching
      [-0.12, 0, 0],          // hold
      [0, 0, 0],
    ]),
    // Right hand: fingers curl → spread clawing → grip drain
    quatTrack("R_Hand", [0, 0.15, 0.30, 0.36, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.3, 0, -0.2],        // fingers closing
      [-0.5, 0, -0.4],        // fist — compressed dark energy
      [-0.5, 0, -0.4],        // HOLD (micro-pause)
      [0.6, 0.2, -0.4],       // CLAW open — fingers spread wide
      [0.5, 0.15, -0.35],     // sustain drain
      [0, 0, 0],
    ]),
    // Left arm: pulls energy inward toward chest
    quatTrack("L_Shoulder", [0, 0.15, 0.30, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.4, 0, -0.5],        // arm rises
      [-0.8, 0, -0.7],        // wide — channeling
      [0.3, 0, -0.5],         // PULLS toward body
      [0.4, 0, -0.4],         // holds at chest
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.15, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.9, 0, 0],           // elbow tight — siphoning
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Body hunches forward — predatory
    quatTrack("Chest", [0, 0.10, 0.30, 0.38, 0.55, d], [
      [0, 0, 0],
      [0.12, 0, 0.05],        // slight crouch
      [0.18, 0, 0.08],        // coiled
      [-0.40, 0, -0.10],      // LUNGE into drain
      [-0.32, 0, -0.06],      // hold
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.12, 0.38, 0.55, d], [
      [0, 0, 0],
      [0.06, -0.05, 0],
      [-0.18, -0.10, 0],      // twist into target
      [-0.12, -0.06, 0],
      [0, 0, 0],
    ]),
    // Head: chin down, sinister focus → locks onto target
    quatTrack("Head", [0, 0.15, 0.30, 0.38, 0.55, d], [
      [0, 0, 0],
      [0.12, -0.08, 0],       // chin down — menacing
      [0.08, -0.05, 0],       // watching energy gather
      [0.18, -0.12, 0],       // LOCKS onto target — intense stare
      [0.12, -0.08, 0],       // hold
      [0, 0, 0],
    ]),
    // Hips: crouch → drive forward
    quatTrack("Hip", [0, 0.15, 0.38, 0.55, d], [
      [0, 0, 0],
      [0.08, -0.06, 0],       // crouch
      [-0.12, -0.08, 0],      // drive into drain
      [-0.05, -0.03, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.38, d], [
      [0, 0, 0],
      [0.25, 0, 0],           // forward step
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.38, d], [
      [0, 0, 0],
      [0.30, 0, 0],           // bent
      [0, 0, 0],
    ]),
    quatTrack("L_Hip", [0, 0.38, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // braces
      [0, 0, 0],
    ]),
  ]);
}

// ── Holy Cast (cleric) ──────────────────────────────────────────────
// 0.75s — arms invoke skyward → compress light → release radiance downward
// 0-0.20 invoke | 0.20-0.35 peak gather | 0.35-0.40 RELEASE | 0.40-0.55 radiance | 0.55-0.75 settle

function createHolyCastClip(): THREE.AnimationClip {
  const d = 0.75;

  return new THREE.AnimationClip("holycast", d, [
    // Arms rise invoking → gather → SWEEP down releasing light
    quatTrack("R_Shoulder", [0, 0.12, 0.20, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.0, 0, 0.3],         // arms begin rising
      [-1.8, 0, 0.5],         // wide invocation
      [-2.2, 0, 0.35],        // peak — reaching to the heavens
      [-0.2, 0, 0.2],         // SWEEP down — releasing light
      [0.1, 0, 0.1],          // palms out — radiance flowing
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.12, 0.20, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-1.0, 0, -0.3],
      [-1.8, 0, -0.5],
      [-2.2, 0, -0.35],       // peak mirror
      [-0.2, 0, -0.2],        // sweep down
      [0.1, 0, -0.1],
      [0, 0, 0],
    ]),
    // Elbows: extend upward → bend on sweep
    quatTrack("R_Arm", [0, 0.20, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-0.15, 0, 0],          // fully extended skyward
      [-0.3, 0, 0],           // bend on sweep
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.20, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-0.15, 0, 0],
      [-0.3, 0, 0],
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Palms: face sky → HOLD → push light outward on release
    quatTrack("R_Hand", [0, 0.20, 0.35, 0.38, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, 0.4],         // palm opening upward
      [-0.8, 0, 0.6],         // fully open to sky — receiving
      [-0.8, 0, 0.6],         // HOLD (divine pause)
      [0.4, 0, -0.3],         // PUSH light outward
      [0.15, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.20, 0.35, 0.38, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.5, 0, -0.4],
      [-0.8, 0, -0.6],
      [-0.8, 0, -0.6],        // HOLD mirror
      [0.4, 0, 0.3],
      [0.15, 0, 0.1],
      [0, 0, 0],
    ]),
    // Chest: lifts during invocation → settles on release
    quatTrack("Chest", [0, 0.15, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.12, 0, 0],          // chest begins lifting
      [-0.30, 0, 0],          // peak — chest open, heart forward
      [-0.08, 0, 0],          // settles on release
      [0.05, 0, 0],           // slight recoil
      [0, 0, 0],
    ]),
    // Spine arches back gracefully
    quatTrack("Spine", [0, 0.20, 0.35, 0.40, d], [
      [0, 0, 0],
      [-0.08, 0, 0],
      [-0.18, 0, 0],          // arch back
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Head: gazes skyward → drops to target on release
    quatTrack("Head", [0, 0.15, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.15, 0, 0],          // look up
      [-0.40, 0, 0],          // gaze skyward — reverent
      [0.08, 0, 0],           // SNAP down to target
      [0.03, 0, 0],
      [0, 0, 0],
    ]),
    // Hips: rise slightly (on toes) during invocation
    quatTrack("Hip", [0, 0.20, 0.35, 0.40, 0.55, d], [
      [0, 0, 0],
      [-0.05, 0, 0],
      [-0.12, 0, 0],          // peak rise
      [-0.06, 0, 0],          // settle
      [-0.02, 0, 0],
      [0, 0, 0],
    ]),
    // Feet: rise onto toes during invocation
    quatTrack("L_Foot", [0, 0.20, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.25, 0, 0],
      [-0.45, 0, 0],          // toes pointed — rising
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Foot", [0, 0.20, 0.35, 0.55, d], [
      [0, 0, 0],
      [-0.25, 0, 0],
      [-0.45, 0, 0],
      [-0.1, 0, 0],
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

// ── Palm Strike (monk) ──────────────────────────────────────────────
// 0.45s — fast open-palm thrust from the core, chi-style
// 0-0.10 chamber | 0.10-0.16 STRIKE | 0.16-0.20 impact | 0.20-0.35 retract | 0.35-0.45 settle

function createPalmStrikeClip(): THREE.AnimationClip {
  const d = 0.45;
  return new THREE.AnimationClip("palmstrike", d, [
    // Hips drive — sharp rotation for power
    quatTrack("Hip", [0, 0.06, 0.10, 0.16, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.05, 0.20, 0],         // load back
      [0.08, 0.30, 0],         // coil
      [-0.10, -0.35, 0],       // EXPLODE forward
      [-0.08, -0.25, 0],       // impact hold
      [-0.03, -0.08, 0],
      [0, 0, 0],
    ]),
    // Chest snaps — sharp and direct
    quatTrack("Chest", [0, 0.10, 0.16, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.15, 0.10, 0],         // pulled back, tight
      [-0.40, -0.15, 0],       // SNAP forward
      [-0.30, -0.10, 0],       // hold
      [-0.08, -0.03, 0],
      [0, 0, 0],
    ]),
    // Right arm: chambers at hip → THRUSTS palm forward
    quatTrack("R_Shoulder", [0, 0.08, 0.10, 0.16, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.3, 0, -0.3],          // arm at side
      [0.5, 0.15, -0.4],       // chamber at hip — fist cocked
      [0.8, -0.10, -0.1],      // THRUST forward — palm out
      [0.6, -0.05, -0.1],      // hold
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.16, 0.20, d], [
      [0, 0, 0],
      [-1.2, 0, 0],            // elbow deeply bent — chambered
      [-0.05, 0, 0],           // EXTEND — full thrust
      [-0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Right hand: fist → OPEN palm snap
    quatTrack("R_Hand", [0, 0.10, 0.14, 0.16, 0.20, d], [
      [0, 0, 0],
      [-0.5, 0, -0.3],         // closed fist
      [-0.5, 0, -0.3],         // hold fist (micro-pause)
      [0.6, 0, 0.4],           // PALM OPENS — chi release
      [0.3, 0, 0.2],
      [0, 0, 0],
    ]),
    // Left arm: guard position — pulls back for balance
    quatTrack("L_Shoulder", [0, 0.10, 0.16, 0.35, d], [
      [0, 0, 0],
      [0.3, 0, -0.5],          // guard at side
      [-0.2, 0, -0.6],         // pull back as right extends
      [-0.1, 0, -0.2],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.10, 0.16, d], [
      [0, 0, 0],
      [-0.8, 0, 0],            // bent guard
      [-0.5, 0, 0],
      [0, 0, 0],
    ]),
    // Head snaps to target
    quatTrack("Head", [0, 0.10, 0.16, 0.35, d], [
      [0, 0, 0],
      [0.05, 0.08, 0],
      [-0.12, -0.06, 0],       // focused on target
      [-0.03, 0, 0],
      [0, 0, 0],
    ]),
    // Front leg drives forward
    quatTrack("L_Hip", [0, 0.10, 0.16, 0.35, d], [
      [0, 0, 0],
      [-0.10, 0, 0],
      [0.40, 0, 0],            // lunge
      [0.10, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.16, 0.35, d], [
      [0, 0, 0],
      [0.35, 0, 0],            // deep bend
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.10, 0.16, d], [
      [0, 0, 0],
      [0.40, 0, 0],            // rear leg loaded
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Flying Kick (monk) ──────────────────────────────────────────────
// 0.65s — leap → airborne kick → land
// 0-0.12 crouch | 0.12-0.22 LEAP | 0.22-0.32 kick extend | 0.32-0.45 hang | 0.45-0.65 land

function createFlyingKickClip(): THREE.AnimationClip {
  const d = 0.65;
  return new THREE.AnimationClip("flyingkick", d, [
    // Hips: crouch → launch upward → return
    quatTrack("Hip", [0, 0.08, 0.12, 0.22, 0.32, 0.45, d], [
      [0, 0, 0],
      [0.15, 0, 0],            // crouch down
      [0.20, 0, 0],            // deep crouch — loading
      [-0.25, -0.15, 0],       // LAUNCH — hips drive forward
      [-0.20, -0.10, 0],       // airborne
      [-0.10, -0.05, 0],       // descending
      [0, 0, 0],
    ]),
    // Chest: leans back in crouch → drives forward in air
    quatTrack("Chest", [0, 0.12, 0.22, 0.32, 0.45, d], [
      [0, 0, 0],
      [0.20, 0, 0],            // lean back loading
      [-0.35, 0, 0],           // thrust forward — flying
      [-0.25, 0, 0],           // hold
      [-0.10, 0, 0],
      [0, 0, 0],
    ]),
    // Right leg: THE KICK — extends forward
    quatTrack("R_Hip", [0, 0.12, 0.22, 0.32, 0.45, d], [
      [0, 0, 0],
      [0.30, 0, 0],            // knee up — chambered
      [-0.80, 0, 0],           // LEG THRUSTS FORWARD — kick
      [-0.70, 0, 0],           // hold extension
      [-0.20, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.12, 0.22, 0.32, 0.45, d], [
      [0, 0, 0],
      [1.20, 0, 0],            // knee deeply bent — chambered
      [0.05, 0, 0],            // FULLY EXTENDED — straight leg kick
      [0.08, 0, 0],            // hold
      [0.30, 0, 0],
      [0, 0, 0],
    ]),
    // Left leg: pushes off then trails behind
    quatTrack("L_Hip", [0, 0.12, 0.22, 0.32, d], [
      [0, 0, 0],
      [-0.10, 0, 0],           // plant
      [0.40, 0, 0],            // push off — trails behind
      [0.30, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.12, 0.22, d], [
      [0, 0, 0],
      [0.50, 0, 0],            // bent for launch
      [0.60, 0, 0],            // trailing bent
      [0, 0, 0],
    ]),
    // Arms: spread for balance in air
    quatTrack("R_Shoulder", [0, 0.12, 0.22, 0.45, d], [
      [0, 0, 0],
      [0.3, 0, -0.3],          // guard
      [-0.8, 0, 0.5],          // arm spread wide — airborne balance
      [-0.3, 0, 0.2],
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.12, 0.22, 0.45, d], [
      [0, 0, 0],
      [0.3, 0, -0.5],
      [-0.8, 0, -0.5],         // mirror spread
      [-0.3, 0, -0.2],
      [0, 0, 0],
    ]),
    // Head: tracks target throughout
    quatTrack("Head", [0, 0.12, 0.22, 0.45, d], [
      [0, 0, 0],
      [0.10, 0, 0],            // look up at target
      [-0.15, 0, 0],           // lock on during kick
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Whirlwind Kick (monk) ───────────────────────────────────────────
// 0.70s — spinning roundhouse kick with full body rotation
// 0-0.12 wind | 0.12-0.20 SPIN1 | 0.20-0.35 kick | 0.35-0.50 SPIN2 | 0.50-0.70 land

function createWhirlwindKickClip(): THREE.AnimationClip {
  const d = 0.70;
  return new THREE.AnimationClip("whirlwindkick", d, [
    // Hips: FULL ROTATION — the spin driver
    quatTrack("Hip", [0, 0.08, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.05, 0.30, 0],          // wind up twist
      [0.08, 0.60, 0],          // coiled
      [-0.05, -1.20, 0],        // SPIN — fast half rotation
      [-0.05, -2.80, 0],        // continue spin — kick lands
      [-0.03, -3.14, 0],        // full 180° complete
      [0, -3.14, 0],            // settle (facing opposite, will reset)
    ]),
    // Chest follows through spin
    quatTrack("Chest", [0, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.10, 0.15, 0],          // coiled
      [-0.20, -0.20, -0.10],    // lean into spin
      [-0.15, -0.10, -0.05],    // during kick
      [-0.05, 0, 0],
      [0, 0, 0],
    ]),
    // Right leg: THE ROUNDHOUSE — swings out during spin
    quatTrack("R_Hip", [0, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.20, 0, 0.15],          // chamber
      [-0.50, 0, 0.80],         // LEG SWINGS OUT — roundhouse
      [-0.40, 0, 0.60],         // extended through target
      [-0.10, 0, 0.15],         // retract
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.80, 0, 0],             // chambered — bent
      [0.10, 0, 0],             // EXTENDS on kick
      [0.15, 0, 0],             // hold
      [0.30, 0, 0],
      [0, 0, 0],
    ]),
    // Left leg: pivot foot — stays planted
    quatTrack("L_Hip", [0, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.15, 0, -0.10],         // slight bend
      [0.10, 0, -0.05],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.40, 0, 0],             // bent — low center of gravity
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
    // Arms: whip with the spin — centrifugal
    quatTrack("R_Shoulder", [0, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.2, 0, -0.3],           // pull in
      [-1.0, 0, 0.6],           // FLINGS out with spin
      [-0.8, 0, 0.4],           // trailing
      [-0.2, 0, 0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Shoulder", [0, 0.12, 0.20, 0.35, 0.50, d], [
      [0, 0, 0],
      [0.2, 0, -0.5],           // guard
      [-1.0, 0, -0.6],          // flings out opposite
      [-0.8, 0, -0.4],
      [-0.2, 0, -0.1],
      [0, 0, 0],
    ]),
    // Head stays locked on target
    quatTrack("Head", [0, 0.12, 0.20, 0.35, d], [
      [0, 0, 0],
      [0.05, -0.15, 0],         // look over shoulder
      [-0.10, 0.30, 0],         // snap around with spin
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
      [0.6, 0, 0],         // bending forward
      [0.65, 0, 0],        // hold with wobble
      [0.6, 0, 0],
      [0, 0, 0],           // stand up
    ]),
    quatTrack("Chest", [0, 0.55, 0.90, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0.3, 0, 0],
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

// ── Mine ────────────────────────────────────────────────────────────
// 1.6s one-shot — overhead pickaxe swing, wide stance, two strikes

function createMineClip(): THREE.AnimationClip {
  const d = 1.6;
  const h = d / 2;

  return new THREE.AnimationClip("mine", d, [
    // Wide squat stance
    quatTrack("L_Hip", [0, 0.15, h, h + 0.15, d], [
      [0, 0, 0],
      [0.25, 0, -0.1],
      [0.25, 0, -0.1],
      [0.25, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.15, h, h + 0.15, d], [
      [0, 0, 0],
      [0.25, 0, 0.1],
      [0.25, 0, 0.1],
      [0.25, 0, 0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.15, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.15, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0, 0, 0],
    ]),
    // Two overhead swings — raise, slam, raise, slam
    quatTrack("R_Shoulder", [0, 0.25, 0.45, 0.55, h + 0.05, h + 0.25, d], [
      [0, 0, -0.1],
      [-2.2, 0, -0.3],   // wind up high
      [0.6, 0, 0.1],     // STRIKE down
      [0.3, 0, 0],       // recoil
      [-2.2, 0, -0.3],   // wind up again
      [0.6, 0, 0.1],     // STRIKE
      [0, 0, -0.1],
    ]),
    quatTrack("R_Arm", [0, 0.25, 0.45, h + 0.05, h + 0.25, d], [
      [0, 0, 0],
      [-1.4, 0, 0],      // elbow back for wind-up
      [-0.2, 0, 0],
      [-1.4, 0, 0],
      [-0.2, 0, 0],
      [0, 0, 0],
    ]),
    // Left arm grips handle too
    quatTrack("L_Shoulder", [0, 0.25, 0.45, h + 0.05, h + 0.25, d], [
      [0, 0, 0],
      [-1.8, 0, 0.3],
      [0.4, 0, -0.1],
      [-1.8, 0, 0.3],
      [0.4, 0, -0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.25, 0.45, d], [
      [0, 0, 0],
      [-1.2, 0, 0],
      [-0.3, 0, 0],
      [0, 0, 0],
    ]),
    // Torso leans into swings
    quatTrack("Spine", [0, 0.25, 0.45, 0.55, h + 0.05, h + 0.25, d], [
      [0, 0, 0],
      [-0.15, 0, 0],
      [0.3, 0, 0],       // lean forward on strike
      [0.15, 0, 0],
      [-0.15, 0, 0],
      [0.3, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.45, h + 0.25, d], [
      [0, 0, 0],
      [0.15, 0, 0],
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Forage ──────────────────────────────────────────────────────────
// 2.0s one-shot — kneel down, gently pluck, examine, stand

function createForageClip(): THREE.AnimationClip {
  const d = 2.0;

  return new THREE.AnimationClip("forage", d, [
    // Deep kneel
    quatTrack("L_Hip", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.7, 0, 0],
      [0.7, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.5, 0, 0],
      [0.5, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [1.1, 0, 0],       // deep knee bend
      [1.1, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.8, 0, 0],
      [0.8, 0, 0],
      [0, 0, 0],
    ]),
    // Lean forward to reach
    quatTrack("Spine", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.5, 0, 0],
      [0.45, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
    // Right hand reaches down, plucks delicately, brings up to examine
    quatTrack("R_Shoulder", [0, 0.5, 0.8, 1.0, 1.3, d], [
      [0, 0, 0],
      [1.6, 0, 0],       // reach down
      [1.7, 0, 0.15],    // pluck (slight twist)
      [1.4, 0, -0.1],    // pull up
      [-0.3, 0, 0],      // bring to face to examine
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.5, 0.8, 1.3, d], [
      [0, 0, 0],
      [-0.2, 0, 0],
      [-0.1, 0, 0.1],    // wrist twist for pluck
      [-0.8, 0, 0],      // hold up to face
      [0, 0, 0],
    ]),
    // Left arm braces on knee
    quatTrack("L_Shoulder", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [0.8, 0, 0],
      [0.8, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.5, 1.3, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-0.6, 0, 0],
      [0, 0, 0],
    ]),
    // Head looks down then up at item
    quatTrack("Head", [0, 0.5, 1.0, 1.3, d], [
      [0, 0, 0],
      [0.3, 0, 0],       // look at ground
      [0.3, 0, 0],
      [-0.15, 0, 0],     // look at held item
      [0, 0, 0],
    ]),
  ]);
}

// ── Skin ────────────────────────────────────────────────────────────
// 1.8s one-shot — crouch beside carcass, lateral scraping strokes

function createSkinClip(): THREE.AnimationClip {
  const d = 1.8;

  // 3 scraping strokes
  const strokeTimes: number[] = [];
  const rShoulderEulers: [number, number, number][] = [];
  const rArmEulers: [number, number, number][] = [];
  const chestEulers: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const t = 0.35 + i * 0.4;
    // Start of stroke (arm to one side)
    strokeTimes.push(t);
    rShoulderEulers.push([0.8, 0.4, 0]);
    rArmEulers.push([-0.3, 0, 0]);
    chestEulers.push([0.3, 0.1, 0]);
    // End of stroke (sweep across)
    strokeTimes.push(t + 0.25);
    rShoulderEulers.push([0.8, -0.5, 0]);
    rArmEulers.push([-0.2, 0, 0]);
    chestEulers.push([0.3, -0.1, 0]);
  }

  return new THREE.AnimationClip("skin", d, [
    // Crouch low beside target
    quatTrack("L_Hip", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [0.6, 0, -0.15],
      [0.6, 0, -0.15],
      [0, 0, 0],
    ]),
    quatTrack("R_Hip", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [0.4, 0, 0.1],
      [0.4, 0, 0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [0.9, 0, 0],
      [0.9, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("R_Knee", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [0.7, 0, 0],
      [0.7, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [0.45, 0, 0],
      [0.45, 0, 0],
      [0, 0, 0],
    ]),
    // Scraping strokes
    quatTrack("R_Shoulder", strokeTimes, rShoulderEulers),
    quatTrack("R_Arm", strokeTimes, rArmEulers),
    quatTrack("Chest", strokeTimes, chestEulers),
    // Left hand holds carcass steady
    quatTrack("L_Shoulder", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.25, 1.55, d], [
      [0, 0, 0],
      [-0.5, 0, 0],
      [-0.5, 0, 0],
      [0, 0, 0],
    ]),
    // Head watches work
    quatTrack("Head", [0, 0.25, d], [
      [0, 0, 0],
      [0.25, 0.1, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Brew ────────────────────────────────────────────────────────────
// 2.2s one-shot — stand at cauldron, circular stirring, sprinkle ingredient

function createBrewClip(): THREE.AnimationClip {
  const d = 2.2;

  // Circular stirring: 4 rotations of the right arm
  const stirTimes: number[] = [];
  const rShoulderEulers: [number, number, number][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = 0.3 + (i / steps) * 1.4;
    const angle = (i / steps) * Math.PI * 2 * 2; // 2 full circles
    stirTimes.push(t);
    rShoulderEulers.push([
      0.6 + Math.sin(angle) * 0.3,
      Math.cos(angle) * 0.25,
      0,
    ]);
  }

  return new THREE.AnimationClip("brew", d, [
    // Slight lean forward over cauldron
    quatTrack("Spine", [0, 0.2, 1.8, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.2, 1.8, d], [
      [0, 0, 0],
      [0.15, 0, 0],
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Stirring arm
    quatTrack("R_Shoulder", stirTimes, rShoulderEulers),
    quatTrack("R_Arm", [0, 0.3, 1.7, d], [
      [0, 0, 0],
      [-0.6, 0, 0],
      [-0.6, 0, 0],
      [0, 0, 0],
    ]),
    // Left hand: hold steady then sprinkle ingredient
    quatTrack("L_Shoulder", [0, 0.2, 1.7, 1.85, 2.0, d], [
      [0, 0, 0],
      [0.3, 0, 0.2],     // holding edge
      [0.3, 0, 0.2],
      [-0.5, 0, 0.3],    // raise up with ingredient
      [0.4, 0, 0.1],     // sprinkle in
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.2, 1.85, 2.0, d], [
      [0, 0, 0],
      [-0.3, 0, 0],
      [-0.8, 0, 0],      // wrist tilt for sprinkle
      [-0.2, 0, 0],
      [0, 0, 0],
    ]),
    // Head looks into cauldron
    quatTrack("Head", [0, 0.2, 1.7, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Cook ────────────────────────────────────────────────────────────
// 1.8s one-shot — chopping motion then toss into pan

function createCookClip(): THREE.AnimationClip {
  const d = 1.8;

  // 4 chops
  const chopTimes: number[] = [];
  const rShoulderEulers: [number, number, number][] = [];
  const rArmEulers: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const t = 0.15 + i * 0.28;
    // Raise knife
    chopTimes.push(t);
    rShoulderEulers.push([-0.8, 0, -0.1]);
    rArmEulers.push([-0.6, 0, 0]);
    // Chop down
    chopTimes.push(t + 0.15);
    rShoulderEulers.push([0.3, 0, 0]);
    rArmEulers.push([-0.2, 0, 0]);
  }

  return new THREE.AnimationClip("cook", d, [
    // Slight forward lean at counter
    quatTrack("Spine", [0, 0.1, 1.3, d], [
      [0, 0, 0],
      [0.15, 0, 0],
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Chopping arm
    quatTrack("R_Shoulder", chopTimes, rShoulderEulers),
    quatTrack("R_Arm", chopTimes, rArmEulers),
    // Left hand steadies food
    quatTrack("L_Shoulder", [0, 0.1, 1.3, 1.5, d], [
      [0, 0, 0],
      [0.5, 0, 0],       // hold food
      [0.5, 0, 0],
      [0.8, 0, 0.2],     // scoop and toss
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.1, 1.3, 1.5, d], [
      [0, 0, 0],
      [-0.4, 0, 0],
      [-0.4, 0, 0],
      [-0.2, 0, 0.1],    // flip wrist for toss
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.1, 1.3, d], [
      [0, 0, 0],
      [0.1, 0, 0],
      [0.1, 0, 0],
      [0, 0, 0],
    ]),
    // Head looks down at cutting
    quatTrack("Head", [0, 0.1, 1.3, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Enchant ─────────────────────────────────────────────────────────
// 2.4s one-shot — raise arms, channel energy, pulse, release

function createEnchantClip(): THREE.AnimationClip {
  const d = 2.4;

  // Pulsing hand movement during channel
  const pulseTimes: number[] = [];
  const lShoulderEulers: [number, number, number][] = [];
  const rShoulderEulers: [number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = 0.5 + (i / 6) * 1.4;
    const pulse = Math.sin((i / 6) * Math.PI * 3) * 0.15;
    pulseTimes.push(t);
    lShoulderEulers.push([-1.2 + pulse, 0, 0.4 - pulse]);
    rShoulderEulers.push([-1.2 - pulse, 0, -0.4 + pulse]);
  }

  return new THREE.AnimationClip("enchant", d, [
    // Arms raise and channel
    quatTrack("L_Shoulder", pulseTimes, lShoulderEulers),
    quatTrack("R_Shoulder", pulseTimes, rShoulderEulers),
    // Hands splay open during channel
    quatTrack("L_Arm", [0, 0.5, 1.9, d], [
      [0, 0, 0],
      [-0.3, 0, -0.3],
      [-0.3, 0, -0.3],
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.5, 1.9, d], [
      [0, 0, 0],
      [-0.3, 0, 0.3],
      [-0.3, 0, 0.3],
      [0, 0, 0],
    ]),
    // Spine arches back slightly then forward on release
    quatTrack("Spine", [0, 0.5, 1.5, 1.9, d], [
      [0, 0, 0],
      [-0.1, 0, 0],      // lean back
      [-0.15, 0, 0],     // deeper arch
      [0.2, 0, 0],       // thrust forward on release
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.5, 1.5, 1.9, d], [
      [0, 0, 0],
      [-0.1, 0, 0],
      [-0.12, 0, 0],
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Head tilts back during channel, snaps forward on release
    quatTrack("Head", [0, 0.5, 1.5, 1.9, d], [
      [0, 0, 0],
      [-0.2, 0, 0],
      [-0.25, 0, 0],
      [0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Neck twist for mystical feel
    quatTrack("Neck", [0, 0.5, 1.0, 1.5, 1.9, d], [
      [0, 0, 0],
      [0, 0.1, 0],
      [0, -0.1, 0],
      [0, 0.1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Carve ───────────────────────────────────────────────────────────
// 2.0s one-shot — hunched over workpiece, small precise taps/cuts
// Used for leatherworking and jewelcrafting

function createCarveClip(): THREE.AnimationClip {
  const d = 2.0;

  // 5 precise taps
  const tapTimes: number[] = [];
  const rShoulderEulers: [number, number, number][] = [];
  const rArmEulers: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const t = 0.3 + i * 0.3;
    // Raise (small)
    tapTimes.push(t);
    rShoulderEulers.push([0.3, 0, -0.05]);
    rArmEulers.push([-0.5, 0, 0]);
    // Tap
    tapTimes.push(t + 0.12);
    rShoulderEulers.push([0.6, 0, 0.05]);
    rArmEulers.push([-0.25, 0, 0]);
    // Settle
    tapTimes.push(t + 0.22);
    rShoulderEulers.push([0.5, 0, 0]);
    rArmEulers.push([-0.3, 0, 0]);
  }

  return new THREE.AnimationClip("carve", d, [
    // Hunched posture
    quatTrack("Spine", [0, 0.2, 1.8, d], [
      [0, 0, 0],
      [0.35, 0, 0],
      [0.35, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("Chest", [0, 0.2, 1.8, d], [
      [0, 0, 0],
      [0.2, 0, 0],
      [0.2, 0, 0],
      [0, 0, 0],
    ]),
    // Precise tapping hand
    quatTrack("R_Shoulder", tapTimes, rShoulderEulers),
    quatTrack("R_Arm", tapTimes, rArmEulers),
    // Left hand holds workpiece, rotates it occasionally
    quatTrack("L_Shoulder", [0, 0.2, 0.8, 1.4, 1.8, d], [
      [0, 0, 0],
      [0.5, 0, 0.1],
      [0.5, 0.1, 0.1],   // rotate piece
      [0.5, -0.1, 0.1],  // rotate other way
      [0.5, 0, 0.1],
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.2, 1.8, d], [
      [0, 0, 0],
      [-0.7, 0, 0],
      [-0.7, 0, 0],
      [0, 0, 0],
    ]),
    // Head peers closely at work
    quatTrack("Head", [0, 0.2, 1.0, 1.8, d], [
      [0, 0, 0],
      [0.25, 0.1, 0],
      [0.25, -0.1, 0],   // shift gaze
      [0.25, 0, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Mage Auto-Attack (Magic Bolt) ───────────────────────────────────
// 0.50s — quick one-handed bolt throw. Right hand flicks forward.
// 0-0.10 chamber | 0.10-0.18 THROW | 0.18-0.30 follow-through | 0.30-0.50 settle

function createMagicBoltClip(): THREE.AnimationClip {
  const d = 0.50;

  return new THREE.AnimationClip("magicbolt", d, [
    // Right arm: chambers back then flicks forward
    quatTrack("R_Shoulder", [0, 0.10, 0.18, 0.30, d], [
      [0, 0, 0],
      [-1.0, 0, -0.3],          // chamber — hand back by ear
      [0.7, 0, 0.15],           // THROW — arm snaps forward
      [0.3, 0, 0.05],           // follow-through
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.10, 0.18, 0.30, d], [
      [0, 0, 0],
      [-1.0, 0, 0],             // elbow bent — loading
      [-0.1, 0, 0],             // extends on throw
      [-0.15, 0, 0],
      [0, 0, 0],
    ]),
    // Right hand: cups energy → FLINGS open
    quatTrack("R_Hand", [0, 0.08, 0.16, 0.18, 0.30, d], [
      [0, 0, 0],
      [-0.3, 0, -0.3],          // fingers curling — gathering
      [-0.4, 0, -0.4],          // cupped
      [0.5, 0, 0.4],            // FLING — palm opens
      [0.15, 0, 0.1],
      [0, 0, 0],
    ]),
    // Left arm: stays low, slight stabilizing gesture
    quatTrack("L_Shoulder", [0, 0.10, 0.18, d], [
      [0, 0, 0],
      [-0.3, 0, -0.15],         // slight lift
      [-0.15, 0, -0.08],
      [0, 0, 0],
    ]),
    // Chest: slight lean back then forward into throw
    quatTrack("Chest", [0, 0.10, 0.18, 0.30, d], [
      [0, 0, 0],
      [0.12, 0.08, 0],          // lean back
      [-0.25, -0.05, 0],        // thrust forward
      [-0.08, 0, 0],
      [0, 0, 0],
    ]),
    // Head: tracks target
    quatTrack("Head", [0, 0.10, 0.18, d], [
      [0, 0, 0],
      [-0.05, 0.05, 0],         // slight tilt
      [-0.10, 0, 0],            // focused on target
      [0, 0, 0],
    ]),
    // Spine: minimal twist
    quatTrack("Spine", [0, 0.10, 0.18, d], [
      [0, 0, 0],
      [0.05, 0.06, 0],
      [-0.08, -0.03, 0],
      [0, 0, 0],
    ]),
  ]);
}

// ── Ranger Bow Shot ─────────────────────────────────────────────────
// 0.70s — reach → nock → DRAW → hold → RELEASE → follow-through
// Left arm stays extended (bow hand), right arm pulls back (string hand)
// 0-0.12 reach | 0.12-0.28 draw | 0.28-0.34 hold | 0.34-0.38 RELEASE | 0.38-0.55 follow | 0.55-0.70 settle

function createBowShotClip(): THREE.AnimationClip {
  const d = 0.70;

  return new THREE.AnimationClip("bowshot", d, [
    // Left arm: extends forward holding bow — stays steady
    quatTrack("L_Shoulder", [0, 0.12, 0.28, 0.38, 0.55, d], [
      [0, 0, 0],
      [0.8, 0, 0.15],           // arm up and slightly out
      [0.85, 0, 0.10],          // steady aim — bow arm locked
      [0.75, 0, 0.12],          // slight recoil on release
      [0.4, 0, 0.08],           // lowering
      [0, 0, 0],
    ]),
    quatTrack("L_Arm", [0, 0.12, 0.38, d], [
      [0, 0, 0],
      [-0.15, 0, 0],            // nearly straight — holding bow
      [-0.10, 0, 0],            // locked
      [0, 0, 0],
    ]),
    quatTrack("L_Hand", [0, 0.12, 0.28, 0.38, d], [
      [0, 0, 0],
      [-0.3, 0, 0.2],           // gripping bow
      [-0.35, 0, 0.25],         // tight grip during draw
      [-0.1, 0, 0.1],           // relax
      [0, 0, 0],
    ]),
    // Right arm: reaches back to nock → DRAWS string → RELEASES
    quatTrack("R_Shoulder", [0, 0.08, 0.12, 0.28, 0.34, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.6, 0, -0.3],          // reach back for arrow
      [-0.4, 0, -0.15],         // nocking
      [-1.8, 0, -0.35],         // FULL DRAW — elbow way back
      [-1.9, 0, -0.40],         // hold at anchor
      [0.3, 0, 0.1],            // RELEASE — hand snaps forward
      [0.15, 0, 0.05],          // follow-through
      [0, 0, 0],
    ]),
    quatTrack("R_Arm", [0, 0.12, 0.28, 0.34, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.8, 0, 0],             // elbow bent reaching for arrow
      [-1.6, 0, 0],             // deeply bent — string at full draw
      [-1.7, 0, 0],             // anchor point
      [-0.1, 0, 0],             // SNAP straight on release
      [-0.15, 0, 0],            // settle
      [0, 0, 0],
    ]),
    quatTrack("R_Hand", [0, 0.12, 0.28, 0.34, 0.38, d], [
      [0, 0, 0],
      [-0.4, 0, -0.2],          // fingers hooking string
      [-0.5, 0, -0.3],          // pulling
      [-0.5, 0, -0.3],          // HOLD — fingers on string
      [0.5, 0, 0.3],            // RELEASE — fingers open
      [0, 0, 0],
    ]),
    // Chest: slight rotation toward target, lean into draw
    quatTrack("Chest", [0, 0.12, 0.28, 0.38, 0.55, d], [
      [0, 0, 0],
      [-0.08, 0.15, 0],         // rotate toward target, slight lean
      [-0.12, 0.20, 0.05],      // full aim — chest opens
      [-0.05, 0.05, 0],         // release — unwind
      [-0.02, 0.02, 0],
      [0, 0, 0],
    ]),
    quatTrack("Spine", [0, 0.12, 0.28, 0.38, d], [
      [0, 0, 0],
      [-0.05, 0.10, 0],         // slight twist
      [-0.08, 0.12, 0],         // aiming
      [-0.02, 0.03, 0],
      [0, 0, 0],
    ]),
    // Head: looks down at arrow → snaps to target → tracks release
    quatTrack("Head", [0, 0.08, 0.12, 0.28, 0.38, d], [
      [0, 0, 0],
      [-0.15, -0.10, 0],        // glance at arrow hand
      [-0.08, 0.05, 0],         // look forward at target
      [-0.12, 0.08, 0],         // focused aim — slight squint lean
      [-0.05, 0, 0],            // watch arrow fly
      [0, 0, 0],
    ]),
    // Hips: weight shifts to front foot during draw
    quatTrack("Hip", [0, 0.12, 0.28, 0.38, d], [
      [0, 0, 0],
      [0.03, 0.08, 0],          // slight rotation with chest
      [0.05, 0.10, 0],          // weight forward
      [0, 0.03, 0],
      [0, 0, 0],
    ]),
    // Front leg braces
    quatTrack("L_Hip", [0, 0.28, 0.38, d], [
      [0, 0, 0],
      [0.15, 0, 0],             // brace
      [0.08, 0, 0],
      [0, 0, 0],
    ]),
    quatTrack("L_Knee", [0, 0.28, 0.38, d], [
      [0, 0, 0],
      [0.12, 0, 0],             // slight bend
      [0.05, 0, 0],
      [0, 0, 0],
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
        createMagicBoltClip(),
        createBowShotClip(),
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
        createPalmStrikeClip(),
        createFlyingKickClip(),
        createWhirlwindKickClip(),
        createDamageClip(),
        createHealClip(),
        createDeathClip(),
        createGatherClip(),
        createCraftClip(),
        createMineClip(),
        createForageClip(),
        createSkinClip(),
        createBrewClip(),
        createCookClip(),
        createEnchantClip(),
        createCarveClip(),
      ];
      for (const c of all) {
        this.clips.set(c.name, c);
      }
    }
    return this.clips.get(name)!;
  }

  static names(): string[] {
    if (!this.clips) {
      this.get("idle");
    }
    return Array.from(this.clips!.keys());
  }

  static readonly LOOPING = new Set(["walk", "idle"]);
}
