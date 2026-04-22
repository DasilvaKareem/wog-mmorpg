// ── Default Gambits (FF12-style presets) ─────────────────────────────
//
// Ships with every new agent so focus-fire and heal-low-ally work out of
// the box. The agent owner can override via PUT /agent/edicts.
//
// Evaluation order matters: first match wins. Safety/support rules go
// at the top, combat rules at the bottom.

import type { Edict } from "./edicts.js";

const CASTER_CLASSES = new Set(["mage", "warlock", "cleric"]);
const HEALER_CLASSES = new Set(["cleric"]);

function id(slug: string): string {
  return `default:${slug}`;
}

export function getDefaultGambits(classId: string | undefined): Edict[] {
  const cls = String(classId ?? "").toLowerCase();
  const isHealer = HEALER_CLASSES.has(cls);
  const isCaster = CASTER_CLASSES.has(cls);

  const edicts: Edict[] = [
    {
      id: id("flee-critical"),
      name: "Flee when HP critical",
      enabled: true,
      conditions: [
        { subject: "self", field: "hp_pct", operator: "lt", value: 15 },
      ],
      action: { type: "flee" },
    },
    {
      id: id("assist-leader"),
      name: "Assist party leader's target",
      enabled: true,
      conditions: [
        { subject: "leader_target", field: "hp_pct", operator: "gt", value: 0 },
      ],
      action: { type: "best_technique", targetPreference: "leader_target" },
    },
    {
      id: id("assist-party-tag"),
      name: "Focus target tagged by party",
      enabled: true,
      conditions: [
        { subject: "self", field: "nearby_enemies", operator: "gte", value: 1 },
      ],
      action: { type: "best_technique", targetPreference: "party_tagged" },
    },
  ];

  if (isCaster || isHealer) {
    edicts.splice(1, 0, {
      id: id("preserve-essence"),
      name: "Back off when essence low",
      enabled: true,
      conditions: [
        { subject: "self", field: "essence_pct", operator: "lt", value: 15 },
        { subject: "self", field: "hp_pct", operator: "gt", value: 60 },
      ],
      action: { type: "attack" },
    });
  }

  edicts.push({
    id: id("default-attack"),
    name: "Use best technique on nearest foe",
    enabled: true,
    conditions: [
      { subject: "self", field: "always", operator: "is", value: true },
    ],
    action: { type: "best_technique", targetPreference: "nearest" },
  });

  return edicts;
}
