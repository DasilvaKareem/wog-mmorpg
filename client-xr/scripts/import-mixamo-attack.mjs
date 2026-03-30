import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

const [, , inputPathArg, outputPathArg, clipNameArg] = process.argv;

if (!inputPathArg || !outputPathArg || !clipNameArg) {
  console.error("Usage: node scripts/import-mixamo-attack.mjs <input.fbx> <output.ts> <clipName>");
  process.exit(1);
}

const BONE_MAP = {
  Root: "mixamorig9Hips",
  Hip: "mixamorig9Hips",
  Spine: "mixamorig9Spine",
  Chest: "mixamorig9Spine2",
  Neck: "mixamorig9Neck",
  Head: "mixamorig9Head",
  L_Shoulder: "mixamorig9LeftShoulder",
  L_Arm: "mixamorig9LeftArm",
  L_Hand: "mixamorig9LeftHand",
  R_Shoulder: "mixamorig9RightShoulder",
  R_Arm: "mixamorig9RightArm",
  R_Hand: "mixamorig9RightHand",
  L_Hip: "mixamorig9LeftUpLeg",
  L_Knee: "mixamorig9LeftLeg",
  L_Foot: "mixamorig9LeftFoot",
  R_Hip: "mixamorig9RightUpLeg",
  R_Knee: "mixamorig9RightLeg",
  R_Foot: "mixamorig9RightFoot",
};

function makeBone(name) {
  const bone = new THREE.Bone();
  bone.name = name;
  return bone;
}

function buildTargetRig() {
  const root = makeBone("Root");
  const hip = makeBone("Hip");
  const spine = makeBone("Spine");
  const chest = makeBone("Chest");
  const neck = makeBone("Neck");
  const head = makeBone("Head");
  const lShoulder = makeBone("L_Shoulder");
  const lArm = makeBone("L_Arm");
  const lHand = makeBone("L_Hand");
  const rShoulder = makeBone("R_Shoulder");
  const rArm = makeBone("R_Arm");
  const rHand = makeBone("R_Hand");
  const lHip = makeBone("L_Hip");
  const lKnee = makeBone("L_Knee");
  const lFoot = makeBone("L_Foot");
  const rHip = makeBone("R_Hip");
  const rKnee = makeBone("R_Knee");
  const rFoot = makeBone("R_Foot");

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

  root.position.set(0, 0, 0);
  hip.position.set(0, 0.6, 0);
  spine.position.set(0, 0.15, 0);
  chest.position.set(0, 0.4, 0);
  neck.position.set(0, 0.28, 0);
  head.position.set(0, 0.35, 0);
  lShoulder.position.set(-0.3, 0.24, 0);
  rShoulder.position.set(0.3, 0.24, 0);
  lArm.position.set(0, -0.05, 0);
  rArm.position.set(0, -0.05, 0);
  lHand.position.set(0, -0.42, 0);
  rHand.position.set(0, -0.42, 0);
  lHip.position.set(-0.1, 0, 0);
  rHip.position.set(0.1, 0, 0);
  lKnee.position.set(0, -0.2475, 0);
  rKnee.position.set(0, -0.2475, 0);
  lFoot.position.set(0, -0.2025, 0);
  rFoot.position.set(0, -0.2025, 0);

  const bones = [
    root, hip, spine, chest, neck, head,
    lShoulder, lArm, lHand,
    rShoulder, rArm, rHand,
    lHip, lKnee, lFoot,
    rHip, rKnee, rFoot,
  ];

  const skeleton = new THREE.Skeleton(bones);
  const helper = new THREE.SkeletonHelper(root);
  helper.skeleton = skeleton;
  return helper;
}

function roundNumber(value) {
  return Number(value.toFixed(6));
}

function toPascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function formatNumberArray(values) {
  const rounded = Array.from(values, (value) => roundNumber(value));
  const lines = [];
  for (let i = 0; i < rounded.length; i += 8) {
    lines.push(`    ${rounded.slice(i, i + 8).join(", ")}`);
  }
  return `[\n${lines.join(",\n")}\n  ]`;
}

function sanitizeTrack(track) {
  if (!(track instanceof THREE.QuaternionKeyframeTrack)) return null;
  const match = track.name.match(/^\.bones\[(.+?)\]\.quaternion$/);
  if (!match) return null;
  const boneName = match[1];
  if (boneName === "Root") return null;
  const sanitized = new THREE.QuaternionKeyframeTrack(
    `${boneName}.quaternion`,
    track.times,
    track.values,
  );
  const first = sanitized.values.slice(0, 4);
  let animated = false;
  for (let i = 4; i < sanitized.values.length; i += 4) {
    if (
      Math.abs(sanitized.values[i] - first[0]) > 1e-5 ||
      Math.abs(sanitized.values[i + 1] - first[1]) > 1e-5 ||
      Math.abs(sanitized.values[i + 2] - first[2]) > 1e-5 ||
      Math.abs(sanitized.values[i + 3] - first[3]) > 1e-5
    ) {
      animated = true;
      break;
    }
  }
  return animated ? sanitized : null;
}

function generateClipModule(clip) {
  const fnName = `create${toPascalCase(clip.name)}Clip`;
  const trackBodies = clip.tracks.map((track) => {
    return `    new THREE.QuaternionKeyframeTrack(\n      ${JSON.stringify(track.name)},\n      ${formatNumberArray(track.times)},\n      ${formatNumberArray(track.values)},\n    )`;
  });

  return `import * as THREE from "three";

export function ${fnName}(): THREE.AnimationClip {
  return new THREE.AnimationClip(${JSON.stringify(clip.name)}, ${roundNumber(clip.duration)}, [
${trackBodies.join(",\n")}
  ]);
}
`;
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const data = readFileSync(inputPath);
const parsed = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
const sourceBones = [];
parsed.traverse((object) => {
  if (object.isBone) sourceBones.push(object);
});

if (sourceBones.length === 0 || !parsed.animations?.length) {
  throw new Error("FBX did not contain a skeleton animation.");
}

const source = new THREE.SkeletonHelper(sourceBones[0]);
source.skeleton = new THREE.Skeleton(sourceBones);

const target = buildTargetRig();
const sourceClip = parsed.animations[0];
const retargeted = retargetClip(target, source, sourceClip, {
  names: BONE_MAP,
  hip: "Hip",
  fps: 24,
  preserveBoneMatrix: true,
  preserveBonePositions: true,
  useFirstFramePosition: false,
});

const sanitizedTracks = retargeted.tracks
  .map((track) => sanitizeTrack(track))
  .filter(Boolean);

const outputClip = new THREE.AnimationClip(clipNameArg, roundNumber(retargeted.duration), sanitizedTracks);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, generateClipModule(outputClip));

console.log(`Wrote ${outputClip.tracks.length} tracks to ${outputPath}`);
