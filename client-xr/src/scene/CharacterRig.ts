import * as THREE from "three";

/**
 * Named bone indices for quick access.
 * The order here matches the order bones are created in buildSkeleton().
 */
export const BoneId = {
  Root: 0,
  Hip: 1,
  Spine: 2,
  Chest: 3,
  Neck: 4,
  Head: 5,
  L_Shoulder: 6,
  L_Arm: 7,
  L_Hand: 8,
  R_Shoulder: 9,
  R_Arm: 10,
  R_Hand: 11,
  L_Hip: 12,
  L_Knee: 13,
  L_Foot: 14,
  R_Hip: 15,
  R_Knee: 16,
  R_Foot: 17,
} as const;

export type BoneIndex = (typeof BoneId)[keyof typeof BoneId];

/** Options for building a character skeleton */
export interface RigParams {
  /** Scale multiplier (bosses are bigger) */
  scale?: number;
  /** Body class proportions */
  shoulderWidth?: number;
  hipWidth?: number;
  torsoHeight?: number;
  legLength?: number;
  armLength?: number;
  /** Female body modifiers */
  isFemale?: boolean;
}

const DEFAULT_RIG: Required<RigParams> = {
  scale: 1,
  shoulderWidth: 0.30,
  hipWidth: 0.10,
  torsoHeight: 0.80,
  legLength: 0.45,
  armLength: 0.42,
  isFemale: false,
};

/**
 * Builds a THREE.Bone skeleton hierarchy for a humanoid character.
 * Visual meshes are attached as children of the relevant bones.
 *
 * Hierarchy:
 *   root → hip → spine → chest → neck → head
 *                              → L_shoulder → L_arm → L_hand
 *                              → R_shoulder → R_arm → R_hand
 *              → L_hip → L_knee → L_foot
 *              → R_hip → R_knee → R_foot
 */
export class CharacterRig {
  readonly bones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly rootBone: THREE.Bone;

  /** Quick access to named bones */
  readonly hip: THREE.Bone;
  readonly spine: THREE.Bone;
  readonly chest: THREE.Bone;
  readonly neck: THREE.Bone;
  readonly head: THREE.Bone;
  readonly lShoulder: THREE.Bone;
  readonly lArm: THREE.Bone;
  readonly lHand: THREE.Bone;
  readonly rShoulder: THREE.Bone;
  readonly rArm: THREE.Bone;
  readonly rHand: THREE.Bone;
  readonly lHip: THREE.Bone;
  readonly lKnee: THREE.Bone;
  readonly lFoot: THREE.Bone;
  readonly rHip: THREE.Bone;
  readonly rKnee: THREE.Bone;
  readonly rFoot: THREE.Bone;

  constructor(params?: RigParams) {
    const p = { ...DEFAULT_RIG, ...params };
    const s = p.scale;
    const fem = p.isFemale;
    const sw = p.shoulderWidth * s * (fem ? 0.88 : 1);
    const hw = p.hipWidth * s * (fem ? 1.2 : 1);
    const th = p.torsoHeight * s * (fem ? 0.95 : 1);
    const ll = p.legLength * s * (fem ? 1.05 : 1);
    const al = p.armLength * s * (fem ? 0.9 : 1);

    // Create all bones
    const root = this.makeBone("Root");
    const hip = this.makeBone("Hip");
    const spine = this.makeBone("Spine");
    const chest = this.makeBone("Chest");
    const neck = this.makeBone("Neck");
    const head = this.makeBone("Head");
    const lShoulder = this.makeBone("L_Shoulder");
    const lArm = this.makeBone("L_Arm");
    const lHand = this.makeBone("L_Hand");
    const rShoulder = this.makeBone("R_Shoulder");
    const rArm = this.makeBone("R_Arm");
    const rHand = this.makeBone("R_Hand");
    const lHip = this.makeBone("L_Hip");
    const lKnee = this.makeBone("L_Knee");
    const lFoot = this.makeBone("L_Foot");
    const rHip = this.makeBone("R_Hip");
    const rKnee = this.makeBone("R_Knee");
    const rFoot = this.makeBone("R_Foot");

    // Build hierarchy
    root.add(hip);
    hip.add(spine);
    hip.add(lHip);
    hip.add(rHip);
    spine.add(chest);
    chest.add(neck);
    chest.add(lShoulder);
    chest.add(rShoulder);
    neck.add(head);
    lShoulder.add(lArm);
    lArm.add(lHand);
    rShoulder.add(rArm);
    rArm.add(rHand);
    lHip.add(lKnee);
    lKnee.add(lFoot);
    rHip.add(rKnee);
    rKnee.add(rFoot);

    // Set rest positions (local offsets)
    // Root is at ground level, hip is at the hip joint height
    root.position.set(0, 0, 0);
    hip.position.set(0, ll + 0.15 * s, 0);           // hip height = leg length + small offset
    spine.position.set(0, 0.15 * s, 0);               // spine starts just above hip
    chest.position.set(0, th * 0.5, 0);               // chest is partway up the torso
    neck.position.set(0, th * 0.35, 0);               // neck at top of chest
    head.position.set(0, 0.15 * s, 0);                // head on top of neck

    lShoulder.position.set(-sw, th * 0.3, 0);         // left shoulder offset
    rShoulder.position.set(sw, th * 0.3, 0);          // right shoulder offset
    lArm.position.set(0, -0.05 * s, 0);               // upper arm hangs from shoulder
    rArm.position.set(0, -0.05 * s, 0);
    lHand.position.set(0, -al, 0);                    // hand at end of arm
    rHand.position.set(0, -al, 0);

    lHip.position.set(-hw, 0, 0);                     // left hip joint
    rHip.position.set(hw, 0, 0);                      // right hip joint
    lKnee.position.set(0, -ll * 0.55, 0);             // knee at mid-leg
    rKnee.position.set(0, -ll * 0.55, 0);
    lFoot.position.set(0, -ll * 0.45, 0);             // foot at ground
    rFoot.position.set(0, -ll * 0.45, 0);

    // Collect bones in the canonical order (must match BoneId)
    this.bones = [
      root, hip, spine, chest, neck, head,
      lShoulder, lArm, lHand,
      rShoulder, rArm, rHand,
      lHip, lKnee, lFoot,
      rHip, rKnee, rFoot,
    ];

    this.skeleton = new THREE.Skeleton(this.bones);
    this.rootBone = root;

    // Named refs
    this.hip = hip;
    this.spine = spine;
    this.chest = chest;
    this.neck = neck;
    this.head = head;
    this.lShoulder = lShoulder;
    this.lArm = lArm;
    this.lHand = lHand;
    this.rShoulder = rShoulder;
    this.rArm = rArm;
    this.rHand = rHand;
    this.lHip = lHip;
    this.lKnee = lKnee;
    this.lFoot = lFoot;
    this.rHip = rHip;
    this.rKnee = rKnee;
    this.rFoot = rFoot;
  }

  private makeBone(name: string): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  }

  /** Attach a mesh (or group) to a specific bone */
  attach(boneId: BoneIndex, obj: THREE.Object3D) {
    this.bones[boneId].add(obj);
  }

  /** Get a bone by index */
  bone(id: BoneIndex): THREE.Bone {
    return this.bones[id];
  }
}
