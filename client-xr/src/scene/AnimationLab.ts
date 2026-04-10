import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AnimationLibrary } from "./AnimationLibrary.js";
import { CharacterRig } from "./CharacterRig.js";
import { getGradientMap } from "./ToonPipeline.js";

export type AnimationLabCameraPreset = "front" | "side" | "three-quarter";
export type PreviewWeaponType = "none" | "sword" | "axe" | "staff" | "bow" | "dagger" | "mace" | "pickaxe" | "sickle";
export type PreviewArmorStyle = "none" | "plate" | "chain" | "leather";

export interface RigTuning {
  scale: number;
  shoulderWidth: number;
  hipWidth: number;
  torsoHeight: number;
  legLength: number;
  armLength: number;
  isFemale: boolean;
}

export const DEFAULT_RIG_TUNING: RigTuning = {
  scale: 1,
  shoulderWidth: 0.34,
  hipWidth: 0.16,
  torsoHeight: 0.80,
  legLength: 0.45,
  armLength: 0.52,
  isFemale: false,
};

export type PreviewRace = "human" | "elf" | "dwarf" | "beastkin";
export type PreviewClass = "warrior" | "mage" | "cleric" | "ranger" | "rogue" | "warlock" | "paladin" | "monk";
export type PreviewHair = "short" | "long" | "mohawk" | "ponytail" | "braided" | "afro" | "bald";
export type PreviewSkin = "light" | "medium" | "tan" | "brown" | "dark";

export interface CharacterAppearance {
  race: PreviewRace;
  classId: PreviewClass;
  hairStyle: PreviewHair;
  skinColor: PreviewSkin;
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  race: "human",
  classId: "warrior",
  hairStyle: "short",
  skinColor: "medium",
};

export interface AnimationLabState {
  clipName: string;
  duration: number;
  time: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  showSkeleton: boolean;
  keyTimes: number[];
  cameraPreset: AnimationLabCameraPreset;
  weaponType: PreviewWeaponType;
  shieldEquipped: boolean;
  helmStyle: PreviewArmorStyle;
  chestStyle: PreviewArmorStyle;
  glovesStyle: PreviewArmorStyle;
  legStyle: PreviewArmorStyle;
  shoulderStyle: PreviewArmorStyle;
  beltStyle: PreviewArmorStyle;
  bootStyle: PreviewArmorStyle;
  rigTuning: RigTuning;
  appearance: CharacterAppearance;
}

const BODY_GEO = new THREE.BoxGeometry(0.55, 0.8, 0.3);
const HEAD_GEO = new THREE.SphereGeometry(0.19, 16, 12);
const THIGH_GEO = new THREE.CapsuleGeometry(0.09, 0.2, 4, 8);
const LEG_GEO = new THREE.CapsuleGeometry(0.08, 0.24, 4, 8);
const ARM_GEO = new THREE.CapsuleGeometry(0.07, 0.36, 4, 8);
const HAND_GEO = new THREE.SphereGeometry(0.08, 10, 8);
const SHOULDER_GEO = new THREE.SphereGeometry(0.12, 10, 8);
const SHIELD_GEO = new THREE.BoxGeometry(0.04, 0.35, 0.25);
const HELM_DOME_GEO = new THREE.SphereGeometry(0.23, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.65);
const HELM_NASAL_GEO = new THREE.BoxGeometry(0.03, 0.12, 0.06);
const HELM_CREST_GEO = new THREE.BoxGeometry(0.03, 0.08, 0.2);
const HELM_COIF_GEO = new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
const HELM_CAP_GEO = new THREE.SphereGeometry(0.22, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.45);
const HELM_BRIM_GEO = new THREE.CylinderGeometry(0.25, 0.25, 0.02, 12);
const PAULDRON_PLATE_GEO = new THREE.SphereGeometry(0.14, 6, 5, 0, Math.PI * 2, 0, Math.PI * 0.6);
const PAULDRON_RIM_GEO = new THREE.TorusGeometry(0.12, 0.02, 4, 8);
const PAULDRON_PAD_GEO = new THREE.CapsuleGeometry(0.08, 0.1, 3, 5);
const BELT_GEO = new THREE.TorusGeometry(0.20, 0.02, 4, 12);
const BELT_THIN_GEO = new THREE.TorusGeometry(0.19, 0.015, 4, 12);
const BELT_BUCKLE_GEO = new THREE.BoxGeometry(0.04, 0.04, 0.03);
const BOOT_PLATE_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.18);
const BOOT_CUFF_GEO = new THREE.CylinderGeometry(0.08, 0.07, 0.08, 6);
const BOOT_LEATHER_GEO = new THREE.CapsuleGeometry(0.065, 0.14, 4, 6);
const SWORD_BLADE_GEO = new THREE.BoxGeometry(0.04, 0.55, 0.14);
const SWORD_GUARD_GEO = new THREE.BoxGeometry(0.04, 0.04, 0.22);
const SWORD_HANDLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.18, 6);
const SWORD_POMMEL_GEO = new THREE.SphereGeometry(0.035, 5, 4);
const AXE_HANDLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.65, 6);
const STAFF_POLE_GEO = new THREE.CylinderGeometry(0.02, 0.03, 0.95, 6);
const STAFF_ORB_GEO = new THREE.SphereGeometry(0.06, 8, 6);
const BOW_LIMB_GEO = new THREE.TorusGeometry(0.3, 0.02, 6, 12, Math.PI * 0.8);
const BOW_STRING_GEO = new THREE.CylinderGeometry(0.005, 0.005, 0.5, 3);
const DAGGER_BLADE_GEO = new THREE.BoxGeometry(0.03, 0.28, 0.08);
const DAGGER_HANDLE_GEO = new THREE.CylinderGeometry(0.02, 0.025, 0.12, 6);
const MACE_HANDLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.5, 6);
const MACE_HEAD_GEO = new THREE.DodecahedronGeometry(0.09, 0);
const PICK_HANDLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.55, 6);
const PICK_HEAD_GEO = new THREE.ConeGeometry(0.04, 0.25, 4);
const PICK_BACK_GEO = new THREE.BoxGeometry(0.04, 0.04, 0.12);
const SICKLE_HANDLE_GEO = new THREE.CylinderGeometry(0.025, 0.03, 0.3, 6);
const SICKLE_BLADE_GEO = new THREE.TorusGeometry(0.15, 0.015, 4, 10, Math.PI * 0.6);

// ── Character appearance geometries ──
const CHEST_GEO = new THREE.CapsuleGeometry(0.24, 0.32, 4, 8);
const WAIST_GEO = new THREE.CapsuleGeometry(0.20, 0.12, 4, 8);
const HAIR_SHORT_GEO = new THREE.SphereGeometry(0.22, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.6);
const HAIR_LONG_GEO = new THREE.CapsuleGeometry(0.15, 0.3, 4, 6);
const HAIR_MOHAWK_GEO = new THREE.BoxGeometry(0.06, 0.25, 0.3);
const HAIR_AFRO_GEO = new THREE.SphereGeometry(0.32, 8, 6);
const HAIR_PONYTAIL_GEO = new THREE.CylinderGeometry(0.06, 0.04, 0.5, 5);
const HAIR_BRAID_GEO = new THREE.CylinderGeometry(0.04, 0.03, 0.4, 5);
const EYE_GEO = new THREE.SphereGeometry(0.035, 6, 5);
const NOSE_GEO = new THREE.ConeGeometry(0.03, 0.06, 4);
const MOUTH_GEO = new THREE.BoxGeometry(0.08, 0.015, 0.02);
const FINGER_GEO = new THREE.BoxGeometry(0.08, 0.04, 0.06);
const FOOT_SOLE_GEO = new THREE.BoxGeometry(0.13, 0.05, 0.16);
const TOE_GEO = new THREE.SphereGeometry(0.04, 4, 3);
const EAR_CONE_GEO = new THREE.ConeGeometry(0.04, 0.18, 4);
const EAR_ROUND_GEO = new THREE.SphereGeometry(0.04, 5, 4);

const SKIN_COLORS: Record<PreviewSkin, number> = {
  light: 0xfadcb8,
  medium: 0xd4a574,
  tan: 0xc68c53,
  brown: 0x8d5524,
  dark: 0x5c3310,
};

const CLASS_COLORS: Record<PreviewClass, number> = {
  warrior: 0xcc3333,
  paladin: 0xe6c830,
  mage: 0x3366dd,
  cleric: 0xeeeeff,
  ranger: 0x33aa44,
  rogue: 0x8833bb,
  warlock: 0x33bb66,
  monk: 0xe69628,
};

const AXE_HEAD_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.12);
  shape.quadraticCurveTo(0.18, -0.08, 0.2, 0.04);
  shape.quadraticCurveTo(0.18, 0.16, 0, 0.12);
  shape.lineTo(0, -0.12);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  geo.translate(-0.02, 0, -0.02);
  return geo;
})();

function makeBodyPart(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
  });
}

function makeEquipmentMat(color: number, emissive = 0x000000): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.25 : 0,
    gradientMap: getGradientMap(),
  });
}

export class AnimationLab {
  readonly group = new THREE.Group();
  rig: CharacterRig;
  mixer: THREE.AnimationMixer;
  readonly orbit: OrbitControls;

  private action: THREE.AnimationAction | null = null;
  private clip = AnimationLibrary.get("idle");
  private playhead = 0;
  private playing = true;
  private speed = 1;
  private loop = true;
  private showSkeleton = false;
  private cameraPreset: AnimationLabCameraPreset = "three-quarter";
  private weaponType: PreviewWeaponType = "sword";
  private shieldEquipped = false;
  private helmStyle: PreviewArmorStyle = "none";
  private chestStyle: PreviewArmorStyle = "none";
  private glovesStyle: PreviewArmorStyle = "none";
  private legStyle: PreviewArmorStyle = "none";
  private shoulderStyle: PreviewArmorStyle = "none";
  private beltStyle: PreviewArmorStyle = "none";
  private bootStyle: PreviewArmorStyle = "none";
  private rigTuning: RigTuning = { ...DEFAULT_RIG_TUNING };
  private appearance: CharacterAppearance = { ...DEFAULT_APPEARANCE };
  private skeletonHelper: THREE.SkeletonHelper;
  private floor: THREE.GridHelper;
  private ambient: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private listeners = new Set<(state: AnimationLabState) => void>();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    scene.fog = null;
    scene.background = new THREE.Color(0xd8d2c4);

    this.group.name = "animation_lab";
    scene.add(this.group);

    this.floor = new THREE.GridHelper(12, 24, 0x2f2a23, 0x9d9382);
    this.floor.position.y = 0;
    this.group.add(this.floor);

    this.ambient = new THREE.HemisphereLight(0xfdf4e7, 0x7a6d58, 1.4);
    scene.add(this.ambient);

    this.key = new THREE.DirectionalLight(0xfff3dd, 2.0);
    this.key.position.set(3.5, 5, 4);
    scene.add(this.key);

    this.fill = new THREE.DirectionalLight(0xd6ebff, 0.8);
    this.fill.position.set(-4, 3, -2);
    scene.add(this.fill);

    this.rig = new CharacterRig();
    this.group.add(this.rig.rootBone);
    this.buildPreviewAvatar();

    this.mixer = new THREE.AnimationMixer(this.rig.rootBone);
    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.rootBone);
    this.skeletonHelper.visible = false;
    this.group.add(this.skeletonHelper);

    this.orbit = new OrbitControls(camera, domElement);
    this.orbit.enableDamping = true;
    this.orbit.target.set(0, 1.05, 0);
    this.applyCameraPreset("three-quarter", camera);

    this.setClip("idle");
    this.rebuildEquipment();
  }

  onChange(listener: (state: AnimationLabState) => void) {
    this.listeners.add(listener);
    listener(this.getState());
  }

  offChange(listener: (state: AnimationLabState) => void) {
    this.listeners.delete(listener);
  }

  getClipNames(): string[] {
    return AnimationLibrary.names();
  }

  getState(): AnimationLabState {
    return {
      clipName: this.clip.name,
      duration: this.clip.duration,
      time: this.playhead,
      playing: this.playing,
      speed: this.speed,
      loop: this.loop,
      showSkeleton: this.showSkeleton,
      keyTimes: this.getKeyTimes(),
      cameraPreset: this.cameraPreset,
      weaponType: this.weaponType,
      shieldEquipped: this.shieldEquipped,
      helmStyle: this.helmStyle,
      chestStyle: this.chestStyle,
      glovesStyle: this.glovesStyle,
      legStyle: this.legStyle,
      shoulderStyle: this.shoulderStyle,
      beltStyle: this.beltStyle,
      bootStyle: this.bootStyle,
      rigTuning: { ...this.rigTuning },
      appearance: { ...this.appearance },
    };
  }

  setClip(name: string) {
    const clip = AnimationLibrary.get(name);
    this.action?.stop();
    this.action = this.mixer.clipAction(clip);
    this.clip = clip;
    this.playhead = 0;
    this.loop = AnimationLibrary.LOOPING.has(name);
    this.configureAction();
    this.action.play();
    this.action.paused = !this.playing;
    this.applyPlayhead();
    this.emit();
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    if (this.action) {
      this.action.paused = !playing;
    }
    if (!playing) {
      this.applyPlayhead();
    }
    this.emit();
  }

  setTime(time: number) {
    this.playhead = THREE.MathUtils.clamp(time, 0, this.clip.duration);
    this.playing = false;
    if (this.action) {
      this.action.paused = true;
    }
    this.applyPlayhead();
    this.emit();
  }

  setSpeed(speed: number) {
    this.speed = THREE.MathUtils.clamp(speed, 0.05, 2);
    this.emit();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    this.configureAction();
    this.applyPlayhead();
    this.emit();
  }

  setShowSkeleton(show: boolean) {
    this.showSkeleton = show;
    this.skeletonHelper.visible = show;
    this.emit();
  }

  setWeaponType(weaponType: PreviewWeaponType) {
    this.weaponType = weaponType;
    this.rebuildEquipment();
  }

  setShieldEquipped(shieldEquipped: boolean) {
    this.shieldEquipped = shieldEquipped;
    this.rebuildEquipment();
  }

  setArmorStyle(slot: "helm" | "chest" | "gloves" | "legs" | "shoulders" | "belt" | "boots", style: PreviewArmorStyle) {
    if (slot === "helm") this.helmStyle = style;
    if (slot === "chest") this.chestStyle = style;
    if (slot === "gloves") this.glovesStyle = style;
    if (slot === "legs") this.legStyle = style;
    if (slot === "shoulders") this.shoulderStyle = style;
    if (slot === "belt") this.beltStyle = style;
    if (slot === "boots") this.bootStyle = style;
    this.rebuildEquipment();
  }

  applyLoadoutPreset(name: "naruto") {
    if (name === "naruto") {
      this.appearance = {
        race: "human",
        classId: "paladin",
        hairStyle: "short",
        skinColor: "tan",
      };
      this.weaponType = "sword";
      this.shieldEquipped = false;
      this.helmStyle = "none";
      this.chestStyle = "chain";
      this.glovesStyle = "plate";
      this.legStyle = "plate";
      this.shoulderStyle = "plate";
      this.beltStyle = "plate";
      this.bootStyle = "none";
      this.stripAvatarMeshes();
      this.buildPreviewAvatar();
      this.rebuildEquipment();
      this.emit();
    }
  }

  setRigTuning(partial: Partial<RigTuning>) {
    Object.assign(this.rigTuning, partial);
    // Tear down old rig
    this.action?.stop();
    this.group.remove(this.rig.rootBone);
    this.group.remove(this.skeletonHelper);
    // Build new rig with updated params
    this.rig = new CharacterRig({
      scale: this.rigTuning.scale,
      shoulderWidth: this.rigTuning.shoulderWidth,
      hipWidth: this.rigTuning.hipWidth,
      torsoHeight: this.rigTuning.torsoHeight,
      legLength: this.rigTuning.legLength,
      armLength: this.rigTuning.armLength,
      isFemale: this.rigTuning.isFemale,
    });
    this.group.add(this.rig.rootBone);
    this.buildPreviewAvatar();
    this.mixer = new THREE.AnimationMixer(this.rig.rootBone);
    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.rootBone);
    this.skeletonHelper.visible = this.showSkeleton;
    this.group.add(this.skeletonHelper);
    // Restore clip
    this.action = this.mixer.clipAction(this.clip);
    this.configureAction();
    this.applyPlayhead();
    this.rebuildEquipment();
    this.emit();
  }

  setAppearance(partial: Partial<CharacterAppearance>) {
    Object.assign(this.appearance, partial);
    // Rebuild avatar visuals (strip old meshes from bones, add new)
    this.stripAvatarMeshes();
    this.buildPreviewAvatar();
    this.rebuildEquipment();
    this.emit();
  }

  private stripAvatarMeshes() {
    // Remove all non-bone children from every bone
    for (const bone of this.rig.bones) {
      const toRemove: THREE.Object3D[] = [];
      for (const child of bone.children) {
        if (!(child instanceof THREE.Bone)) {
          toRemove.push(child);
        }
      }
      for (const obj of toRemove) {
        bone.remove(obj);
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry?.dispose();
      }
    }
  }

  applyEquipmentTuning(slot: string, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number }) {
    this.rig.rootBone.traverse((child) => {
      if (child.userData.equipSlot === slot) {
        child.position.set(pos.x, pos.y, pos.z);
        child.rotation.set(rot.x, rot.y, rot.z);
      }
    });
  }

  applyCameraPreset(preset: AnimationLabCameraPreset, camera: THREE.PerspectiveCamera) {
    this.cameraPreset = preset;
    if (preset === "front") {
      camera.position.set(0, 1.45, 3.2);
    } else if (preset === "side") {
      camera.position.set(3.2, 1.35, 0);
    } else {
      camera.position.set(2.4, 1.6, 2.8);
    }
    this.orbit.target.set(0, 1.0, 0);
    this.orbit.update();
    this.emit();
  }

  jumpToKeyTime(time: number) {
    this.setTime(time);
  }

  update(dt: number) {
    if (this.playing && this.action) {
      this.action.paused = false;
      this.mixer.update(dt * this.speed);
      const actionTime = this.action.time;
      if (this.loop) {
        this.playhead = actionTime % this.clip.duration;
      } else {
        this.playhead = Math.min(actionTime, this.clip.duration);
        if (this.playhead >= this.clip.duration) {
          this.playing = false;
          this.action.paused = true;
        }
      }
      this.emit();
    }

    this.orbit.update();
  }

  dispose(scene: THREE.Scene) {
    this.orbit.dispose();
    this.listeners.clear();
    scene.remove(this.group);
    scene.remove(this.ambient);
    scene.remove(this.key);
    scene.remove(this.fill);
  }

  private configureAction() {
    if (!this.action) return;
    this.action.enabled = true;
    this.action.clampWhenFinished = !this.loop;
    this.action.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, this.loop ? Infinity : 1);
  }

  private applyPlayhead() {
    if (!this.action) return;
    this.action.reset();
    this.action.play();
    this.action.paused = true;
    this.action.time = this.playhead;
    this.mixer.update(0);
  }

  private getKeyTimes(): number[] {
    const times = new Set<number>();
    for (const track of this.clip.tracks) {
      for (const time of track.times) {
        times.add(Number(time.toFixed(3)));
      }
    }
    return Array.from(times).sort((a, b) => a - b);
  }

  private emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private buildPreviewAvatar() {
    const a = this.appearance;
    const fem = this.rigTuning.isFemale;
    const skinHex = SKIN_COLORS[a.skinColor];
    const classHex = CLASS_COLORS[a.classId];
    const skinMat = makeBodyPart(skinHex);
    const classMat = makeBodyPart(classHex);
    const legMat = makeBodyPart(new THREE.Color(skinHex).multiplyScalar(0.95).getHex());
    const bootMat = makeBodyPart(0x5a4a3a);

    // ── Chest (class-colored body) ──
    const body = new THREE.Mesh(CHEST_GEO, classMat);
    const bsx = fem ? 0.88 : 1.0;
    body.scale.set(bsx, fem ? 0.95 : 1.0, fem ? 0.92 : 1.0);
    body.castShadow = true;
    this.rig.chest.add(body);

    // Waist → Spine
    const waist = new THREE.Mesh(WAIST_GEO, classMat);
    waist.scale.set(bsx * (fem ? 0.88 : 1.0), 1, 1);
    this.rig.spine.add(waist);

    // ── Neck ──
    const neckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 0.18, 6),
      skinMat,
    );
    neckMesh.position.y = -0.02;
    if (fem) neckMesh.scale.set(0.85, 1.15, 0.85);
    this.rig.neck.add(neckMesh);

    // ── Head (skin-colored) ──
    const head = new THREE.Mesh(HEAD_GEO, skinMat);
    head.position.y = 0.02;
    this.rig.head.add(head);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x3a6b3a });
    for (const dx of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(EYE_GEO, eyeMat);
      eye.position.set(dx, 0.02, 0.16);
      this.rig.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.position.set(dx, 0.02, 0.18);
      this.rig.head.add(pupil);
    }

    // Nose
    if (a.race !== "beastkin") {
      const nose = new THREE.Mesh(NOSE_GEO, makeBodyPart(new THREE.Color(skinHex).multiplyScalar(0.9).getHex()));
      const noseScale = a.race === "dwarf" ? 1.3 : a.race === "elf" ? 0.8 : fem ? 0.75 : 1.0;
      nose.scale.setScalar(noseScale);
      nose.position.set(0, -0.02, 0.19);
      nose.rotation.x = -0.3;
      this.rig.head.add(nose);
    }

    // Mouth
    if (a.race !== "beastkin") {
      const mouthColor = fem
        ? new THREE.Color(skinHex).lerp(new THREE.Color(0xcc6666), 0.3).getHex()
        : new THREE.Color(skinHex).multiplyScalar(0.55).getHex();
      const mouth = new THREE.Mesh(MOUTH_GEO, makeBodyPart(mouthColor));
      mouth.position.set(0, -0.075, 0.17);
      this.rig.head.add(mouth);
    }

    // Race ears
    if (a.race === "elf") {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(EAR_CONE_GEO, skinMat);
        ear.position.set(side * 0.17, 0.02, 0.04);
        ear.rotation.z = side * -0.9;
        ear.rotation.x = -0.15;
        this.rig.head.add(ear);
      }
    } else if (a.race === "dwarf") {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(EAR_ROUND_GEO, skinMat);
        ear.position.set(side * 0.16, 0.0, 0.04);
        this.rig.head.add(ear);
      }
      // Brow ridge
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.06), makeBodyPart(new THREE.Color(skinHex).multiplyScalar(0.7).getHex()));
      brow.position.set(0, 0.1, 0.14);
      this.rig.head.add(brow);
    } else if (a.race === "beastkin") {
      // Snout
      const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.08, 4, 6), skinMat);
      snout.position.set(0, -0.04, 0.18);
      snout.rotation.x = Math.PI / 2;
      this.rig.head.add(snout);
      // Pointed ears
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(EAR_CONE_GEO, skinMat);
        ear.position.set(side * 0.14, 0.16, 0);
        ear.rotation.z = side * -0.4;
        this.rig.head.add(ear);
      }
    }

    // ── Hair ──
    if (a.hairStyle !== "bald") {
      const hairColor = fem ? 0x4a2a0a : 0x3a2208;
      const hairMat = makeBodyPart(hairColor);
      switch (a.hairStyle) {
        case "short": {
          const h = new THREE.Mesh(HAIR_SHORT_GEO, hairMat);
          h.position.set(0, 0.1, 0);
          this.rig.head.add(h);
          break;
        }
        case "long": {
          const cap = new THREE.Mesh(HAIR_SHORT_GEO, hairMat);
          cap.position.set(0, 0.1, 0);
          this.rig.head.add(cap);
          const drape = new THREE.Mesh(HAIR_LONG_GEO, hairMat);
          drape.position.set(0, -0.02, -0.10);
          this.rig.head.add(drape);
          break;
        }
        case "mohawk": {
          const h = new THREE.Mesh(HAIR_MOHAWK_GEO, hairMat);
          h.position.set(0, 0.25, 0);
          this.rig.head.add(h);
          break;
        }
        case "ponytail": {
          const cap = new THREE.Mesh(HAIR_SHORT_GEO, hairMat);
          cap.position.set(0, 0.1, 0);
          cap.scale.set(1, 0.85, 1);
          this.rig.head.add(cap);
          const tail = new THREE.Mesh(HAIR_PONYTAIL_GEO, hairMat);
          tail.position.set(0, -0.18, -0.20);
          tail.rotation.x = 0.25;
          this.rig.head.add(tail);
          break;
        }
        case "braided": {
          const cap = new THREE.Mesh(HAIR_SHORT_GEO, hairMat);
          cap.position.set(0, 0.1, 0);
          this.rig.head.add(cap);
          for (const dx of [-0.13, 0.13]) {
            const braid = new THREE.Mesh(HAIR_BRAID_GEO, hairMat);
            braid.position.set(dx, -0.20, -0.06);
            this.rig.head.add(braid);
          }
          break;
        }
        case "afro": {
          const h = new THREE.Mesh(HAIR_AFRO_GEO, hairMat);
          h.position.set(0, 0.1, -0.02);
          this.rig.head.add(h);
          break;
        }
      }
    }

    // ── Shoulders + Arms (skin-colored) ──
    const lShoulder = new THREE.Mesh(SHOULDER_GEO, skinMat);
    lShoulder.position.set(0.08, 0, 0);
    const rShoulder = new THREE.Mesh(SHOULDER_GEO, skinMat);
    rShoulder.position.set(-0.08, 0, 0);
    this.rig.lShoulder.add(lShoulder);
    this.rig.rShoulder.add(rShoulder);

    const lUpperArm = new THREE.Mesh(ARM_GEO, skinMat);
    lUpperArm.position.y = -0.24;
    const rUpperArm = new THREE.Mesh(ARM_GEO, skinMat);
    rUpperArm.position.y = -0.24;
    this.rig.lArm.add(lUpperArm);
    this.rig.rArm.add(rUpperArm);

    const lHand = new THREE.Mesh(HAND_GEO, skinMat);
    const rHand = new THREE.Mesh(HAND_GEO, skinMat);
    this.rig.lHand.add(lHand);
    this.rig.rHand.add(rHand);
    const lFingers = new THREE.Mesh(FINGER_GEO, skinMat);
    lFingers.position.set(0, -0.02, 0.04);
    this.rig.lHand.add(lFingers);
    const rFingers = new THREE.Mesh(FINGER_GEO, skinMat);
    rFingers.position.set(0, -0.02, 0.04);
    this.rig.rHand.add(rFingers);

    // ── Legs (skin-colored) ──
    const lThigh = new THREE.Mesh(THIGH_GEO, legMat);
    lThigh.position.y = -0.1;
    const rThigh = new THREE.Mesh(THIGH_GEO, legMat);
    rThigh.position.y = -0.1;
    this.rig.lHip.add(lThigh);
    this.rig.rHip.add(rThigh);

    const lLeg = new THREE.Mesh(LEG_GEO, legMat);
    lLeg.position.y = -0.12;
    const rLeg = new THREE.Mesh(LEG_GEO, legMat);
    rLeg.position.y = -0.12;
    this.rig.lKnee.add(lLeg);
    this.rig.rKnee.add(rLeg);

    // ── Feet (boots) ──
    for (const footBone of [this.rig.lFoot, this.rig.rFoot]) {
      const sole = new THREE.Mesh(FOOT_SOLE_GEO, bootMat);
      sole.position.set(0, -0.04, 0.01);
      footBone.add(sole);
      const toe = new THREE.Mesh(TOE_GEO, bootMat);
      toe.position.set(0, -0.03, 0.08);
      footBone.add(toe);
    }
  }

  private rebuildEquipment() {
    this.clearEquipment();

    if (this.weaponType !== "none") {
      const weapon = this.buildWeaponMesh(this.weaponType);
      this.applyDefaultSocket(weapon, this.weaponType);
      weapon.userData.previewEquipment = true;
      weapon.userData.equipSlot = this.weaponType;
      this.rig.rHand.add(weapon);
    }

    if (this.shieldEquipped) {
      const shield = new THREE.Mesh(SHIELD_GEO, makeEquipmentMat(0x888888));
      shield.position.set(-0.09, 0.05, 0.03);
      shield.rotation.set(0.558, 0.108, 0);
      shield.userData.previewEquipment = true;
      shield.userData.equipSlot = "shield";
      this.rig.lHand.add(shield);
    }

    this.addHelm();
    this.addChest();
    this.addGloves();
    this.addLegs();
    this.addShoulders();
    this.addBelt();
    this.addBoots();
    this.emit();
  }

  private clearEquipment() {
    const toRemove: THREE.Object3D[] = [];
    this.rig.rootBone.traverse((child) => {
      if (child.userData.previewEquipment) {
        toRemove.push(child);
      }
    });
    for (const child of toRemove) {
      child.parent?.remove(child);
    }
  }

  private addHelm() {
    if (this.helmStyle === "none") return;
    const mat = this.helmStyle === "plate"
      ? makeEquipmentMat(0xbbbbcc)
      : this.helmStyle === "chain"
        ? makeEquipmentMat(0x778899)
        : makeEquipmentMat(0x7a5533);
    if (this.helmStyle === "plate") {
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_DOME_GEO, mat), "helmPlate", { y: 0.08 });
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_NASAL_GEO, mat), "helmPlate", { y: -0.02, z: 0.2 });
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_CREST_GEO, mat), "helmPlate", { y: 0.22 });
    } else if (this.helmStyle === "chain") {
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_COIF_GEO, mat), "helmChain", { y: 0.06 });
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), mat), "helmChain", { y: -0.12 });
    } else {
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_CAP_GEO, mat), "helmLeather", { y: 0.1 });
      this.attachPreviewMesh(this.rig.head, new THREE.Mesh(HELM_BRIM_GEO, mat), "helmLeather", { y: 0.04 });
    }
  }

  private addChest() {
    if (this.chestStyle === "none") return;
    const slot = this.chestStyle === "plate" ? "chestPlate" : this.chestStyle === "chain" ? "chestChain" : "chestLeather";
    const mat = this.chestStyle === "plate"
      ? makeEquipmentMat(0xbbbbcc)
      : this.chestStyle === "chain"
        ? makeEquipmentMat(0x778899)
        : makeEquipmentMat(0x7a5533);
    if (this.chestStyle === "plate") {
      const cuirass = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.35, 4, 8), mat);
      cuirass.scale.set(0.92, 0.9, 0.7);
      this.attachPreviewMesh(this.rig.chest, cuirass, slot, { z: 0.06 });
    } else {
      const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.32, 3, 6), mat);
      vest.scale.set(0.94, 0.96, 0.72);
      this.attachPreviewMesh(this.rig.chest, vest, slot, { y: -0.02, z: 0.05 });
    }
  }

  private addGloves() {
    if (this.glovesStyle === "none") return;
    const plate = this.glovesStyle === "plate";
    const slot = plate ? "glovePlate" : "gloveLeather";
    const mat = plate ? makeEquipmentMat(0xbbbbcc) : makeEquipmentMat(0x7a5533);
    for (const arm of [this.rig.lArm, this.rig.rArm]) {
      if (plate) {
        this.attachPreviewMesh(arm, new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.53, 4, 6), mat), slot, { y: -0.12, z: 0.08 });
        this.attachPreviewMesh(arm, new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.07, 6), mat), slot, { y: 0.08, z: 0.05 });
      } else {
        this.attachPreviewMesh(arm, new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.49, 4, 6), mat), slot, { y: -0.12, z: 0.06 });
      }
    }
  }

  private addLegs() {
    if (this.legStyle === "none") return;
    const slot = this.legStyle === "plate" ? "legPlate" : this.legStyle === "chain" ? "legChain" : "legLeather";
    const mat = this.legStyle === "plate"
      ? makeEquipmentMat(0xbbbbcc)
      : this.legStyle === "chain"
        ? makeEquipmentMat(0x778899)
        : makeEquipmentMat(0x7a5533);
    for (const knee of [this.rig.lKnee, this.rig.rKnee]) {
      if (this.legStyle === "plate") {
        this.attachPreviewMesh(knee, new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 3, 6), mat), slot, { y: -0.18, z: 0.10 });
        this.attachPreviewMesh(knee, new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), mat), slot, { y: 0.01, z: 0.10 });
      } else {
        this.attachPreviewMesh(knee, new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.34, 3, 6), mat), slot, { y: -0.18, z: 0.08 });
      }
    }
  }

  private addShoulders() {
    if (this.shoulderStyle === "none") return;
    const slot = this.shoulderStyle === "plate" ? "shoulderPlate" : "shoulderChain";
    const mat = this.shoulderStyle === "plate"
      ? makeEquipmentMat(0xbbbbcc)
      : this.shoulderStyle === "chain"
        ? makeEquipmentMat(0x778899)
        : makeEquipmentMat(0x7a5533);
    for (const shoulder of [this.rig.lShoulder, this.rig.rShoulder]) {
      if (this.shoulderStyle === "plate") {
        const pad = new THREE.Mesh(PAULDRON_PLATE_GEO, mat);
        pad.scale.set(1, 0.8, 1);
        this.attachPreviewMesh(shoulder, pad, slot, { y: 0.05 });
        const rim = new THREE.Mesh(PAULDRON_RIM_GEO, mat);
        rim.rotation.x = Math.PI / 2;
        this.attachPreviewMesh(shoulder, rim, slot, { y: -0.02 });
      } else if (this.shoulderStyle === "chain") {
        const pad = new THREE.Mesh(PAULDRON_PLATE_GEO, mat);
        pad.scale.set(0.8, 0.7, 0.8);
        this.attachPreviewMesh(shoulder, pad, slot, { y: 0.03 });
      } else {
        this.attachPreviewMesh(shoulder, new THREE.Mesh(PAULDRON_PAD_GEO, mat), slot, { y: 0.02 });
      }
    }
  }

  private addBelt() {
    if (this.beltStyle === "none") return;
    const plate = this.beltStyle === "plate";
    const slot = plate ? "beltPlate" : "beltLeather";
    const mat = plate ? makeEquipmentMat(0xbbbbcc) : makeEquipmentMat(0x7a5533);
    const ring = new THREE.Mesh(plate ? BELT_GEO : BELT_THIN_GEO, mat);
    ring.rotation.x = Math.PI / 2;
    this.attachPreviewMesh(this.rig.spine, ring, slot, { y: 0.02 });
    this.attachPreviewMesh(this.rig.spine, new THREE.Mesh(BELT_BUCKLE_GEO, mat), slot, { y: 0.02, z: 0.26 });
  }

  private addBoots() {
    if (this.bootStyle === "none") return;
    const plate = this.bootStyle === "plate";
    const slot = plate ? "bootPlate" : "bootLeather";
    const mat = plate ? makeEquipmentMat(0xbbbbcc) : makeEquipmentMat(0x7a5533);
    for (const knee of [this.rig.lKnee, this.rig.rKnee]) {
      if (plate) {
        this.attachPreviewMesh(knee, new THREE.Mesh(BOOT_PLATE_GEO, mat), slot, { x: 0.01, y: -0.29, z: 0.07 });
        this.attachPreviewMesh(knee, new THREE.Mesh(BOOT_CUFF_GEO, mat), slot, { x: 0.01, y: -0.2, z: 0.07 });
      } else {
        this.attachPreviewMesh(knee, new THREE.Mesh(BOOT_LEATHER_GEO, mat), slot, { y: -0.18, z: 0.01 });
      }
    }
  }

  private attachPreviewMesh(parent: THREE.Object3D, mesh: THREE.Mesh, equipSlot: string, pos: { x?: number; y?: number; z?: number }) {
    mesh.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
    mesh.userData.previewEquipment = true;
    mesh.userData.equipSlot = equipSlot;
    parent.add(mesh);
  }

  private applyDefaultSocket(obj: THREE.Object3D, weaponType: Exclude<PreviewWeaponType, "none">) {
    if (weaponType === "bow") {
      obj.position.set(0.1, 0.02, -0.11);
      obj.rotation.set(0.408, 1.458, 0);
    } else if (weaponType === "staff") {
      obj.position.set(0.03, 0.16, 0.07);
      obj.rotation.set(0.308, 0, 0.05);
    } else if (weaponType === "axe") {
      obj.position.set(-0.02, 0.14, 0.19);
      obj.rotation.set(0.808, -1.342, -0.142);
    } else if (weaponType === "mace") {
      obj.position.set(0.05, 0.09, 0.19);
      obj.rotation.set(1.058, 0.558, -0.1);
    } else if (weaponType === "pickaxe") {
      obj.position.set(0.04, 0.07, 0.23);
      obj.rotation.set(1.158, 0, -0.1);
    } else if (weaponType === "dagger") {
      obj.position.set(0, 0.02, 0.07);
      obj.rotation.set(1.308, 0, -0.1);
    } else {
      obj.position.set(0, 0, 0.1);
      obj.rotation.set(1.408, -0.192, 0.158);
    }
  }

  private buildWeaponMesh(weaponType: Exclude<PreviewWeaponType, "none">): THREE.Group {
    const g = new THREE.Group();
    const metalMat = makeEquipmentMat(0xb8bcc7);
    const handleMat = makeEquipmentMat(0x664422);
    const accentMat = makeEquipmentMat(0x9da6b8);

    if (weaponType === "sword") {
      this.addWeaponPart(g, new THREE.Mesh(SWORD_BLADE_GEO, metalMat), { y: 0.32 });
      this.addWeaponPart(g, new THREE.Mesh(SWORD_GUARD_GEO, accentMat), { y: 0.04 });
      this.addWeaponPart(g, new THREE.Mesh(SWORD_HANDLE_GEO, handleMat), { y: -0.07 });
      this.addWeaponPart(g, new THREE.Mesh(SWORD_POMMEL_GEO, accentMat), { y: -0.17 });
    } else if (weaponType === "axe") {
      this.addWeaponPart(g, new THREE.Mesh(AXE_HANDLE_GEO, handleMat));
      this.addWeaponPart(g, new THREE.Mesh(AXE_HEAD_GEO, metalMat), { x: 0.02, y: 0.22 });
    } else if (weaponType === "staff") {
      this.addWeaponPart(g, new THREE.Mesh(STAFF_POLE_GEO, handleMat));
      this.addWeaponPart(g, new THREE.Mesh(STAFF_ORB_GEO, accentMat), { y: 0.52 });
    } else if (weaponType === "bow") {
      const limb = new THREE.Mesh(BOW_LIMB_GEO, handleMat);
      limb.rotation.z = Math.PI / 2;
      limb.position.y = 0.05;
      this.addWeaponPart(g, limb);
      this.addWeaponPart(g, new THREE.Mesh(BOW_STRING_GEO, new THREE.MeshBasicMaterial({ color: 0xd9d2b7 })), { x: -0.18, y: 0.05 });
    } else if (weaponType === "dagger") {
      this.addWeaponPart(g, new THREE.Mesh(DAGGER_BLADE_GEO, metalMat), { y: 0.18 });
      const guard = new THREE.Mesh(SWORD_GUARD_GEO, accentMat);
      guard.scale.set(1, 1, 0.6);
      this.addWeaponPart(g, guard, { y: 0.03 });
      this.addWeaponPart(g, new THREE.Mesh(DAGGER_HANDLE_GEO, handleMat), { y: -0.04 });
    } else if (weaponType === "mace") {
      this.addWeaponPart(g, new THREE.Mesh(MACE_HANDLE_GEO, handleMat));
      this.addWeaponPart(g, new THREE.Mesh(MACE_HEAD_GEO, metalMat), { y: 0.3 });
    } else if (weaponType === "pickaxe") {
      this.addWeaponPart(g, new THREE.Mesh(PICK_HANDLE_GEO, handleMat));
      const point = new THREE.Mesh(PICK_HEAD_GEO, metalMat);
      point.position.set(0.12, 0.25, 0);
      point.rotation.z = -Math.PI / 2;
      this.addWeaponPart(g, point);
      this.addWeaponPart(g, new THREE.Mesh(PICK_BACK_GEO, metalMat), { x: -0.06, y: 0.25 });
    } else if (weaponType === "sickle") {
      this.addWeaponPart(g, new THREE.Mesh(SICKLE_HANDLE_GEO, handleMat));
      const blade = new THREE.Mesh(SICKLE_BLADE_GEO, metalMat);
      blade.position.set(0, 0.2, 0);
      blade.rotation.z = -Math.PI * 0.3;
      this.addWeaponPart(g, blade);
    }

    g.userData.previewEquipment = true;
    return g;
  }

  private addWeaponPart(group: THREE.Group, mesh: THREE.Mesh, pos?: { x?: number; y?: number; z?: number }) {
    mesh.position.set(pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);
    mesh.castShadow = true;
    mesh.userData.previewEquipment = true;
    group.add(mesh);
  }
}
