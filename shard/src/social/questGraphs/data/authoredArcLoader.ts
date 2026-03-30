import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthoredTalkQuestScene,
  buildKaelaBriefingScene,
  buildMarcusOnboardingScene,
  buildMarcusWelcomeTourScene,
  buildStagedContractsScene,
  type AuthoredTalkQuestSceneConfig,
  type KaelaBriefingSceneConfig,
  type MarcusOnboardingSceneConfig,
  type MarcusWelcomeTourSceneConfig,
  type StagedContractsSceneConfig,
} from "../builders/authoredQuestSceneBuilders.js";
import type { QuestArcDefinition } from "../types.js";
import {
  parseAuthoredQuestArcMeta,
  parseAuthoredTalkQuestSceneConfig,
  parseKaelaBriefingSceneConfig,
  parseMarcusOnboardingSceneConfig,
  parseMarcusWelcomeTourSceneConfig,
  parseStagedContractsSceneConfig,
  type AuthoredQuestArcMeta,
} from "./contentLoader.js";

type AuthoredSceneTemplate =
  | "kaela_briefing"
  | "marcus_onboarding"
  | "marcus_welcome_tour"
  | "staged_contracts"
  | "talk_quest";

interface AuthoredSceneEntry {
  template: AuthoredSceneTemplate;
  config:
    | KaelaBriefingSceneConfig
    | MarcusOnboardingSceneConfig
    | MarcusWelcomeTourSceneConfig
    | StagedContractsSceneConfig
    | AuthoredTalkQuestSceneConfig;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[questGraphs] ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[questGraphs] ${label} must be a non-empty string`);
  }
  return value;
}

function readSceneEntry(input: unknown, label: string): AuthoredSceneEntry {
  const source = assertRecord(input, label);
  const template = readString(source.template, `${label}.template`) as AuthoredSceneTemplate;
  const config = assertRecord(source.config, `${label}.config`);

  switch (template) {
    case "kaela_briefing":
      return {
        template,
        config: parseKaelaBriefingSceneConfig(config, `${label}.config`),
      };
    case "marcus_onboarding":
      return {
        template,
        config: parseMarcusOnboardingSceneConfig(config, `${label}.config`),
      };
    case "marcus_welcome_tour":
      return {
        template,
        config: parseMarcusWelcomeTourSceneConfig(config, `${label}.config`),
      };
    case "staged_contracts":
      return {
        template,
        config: parseStagedContractsSceneConfig(config, `${label}.config`),
      };
    case "talk_quest":
      return {
        template,
        config: parseAuthoredTalkQuestSceneConfig(config, `${label}.config`),
      };
    default:
      throw new Error(`[questGraphs] ${label}.template "${template}" is not supported`);
  }
}

function parseAuthoredArcJson(input: unknown, label: string): {
  meta: AuthoredQuestArcMeta;
  scenes: AuthoredSceneEntry[];
} {
  const source = assertRecord(input, label);
  const meta = parseAuthoredQuestArcMeta(assertRecord(source.meta, `${label}.meta`), `${label}.meta`);
  const rawScenes = source.scenes;
  if (!Array.isArray(rawScenes)) {
    throw new Error(`[questGraphs] ${label}.scenes must be an array`);
  }
  const scenes = rawScenes.map((entry, index) => readSceneEntry(entry, `${label}.scenes[${index}]`));
  return { meta, scenes };
}

function buildScene(entry: AuthoredSceneEntry): QuestArcDefinition["scenes"][string] {
  switch (entry.template) {
    case "kaela_briefing":
      return buildKaelaBriefingScene(entry.config as KaelaBriefingSceneConfig);
    case "marcus_onboarding":
      return buildMarcusOnboardingScene(entry.config as MarcusOnboardingSceneConfig);
    case "marcus_welcome_tour":
      return buildMarcusWelcomeTourScene(entry.config as MarcusWelcomeTourSceneConfig);
    case "staged_contracts":
      return buildStagedContractsScene(entry.config as StagedContractsSceneConfig);
    case "talk_quest":
      return buildAuthoredTalkQuestScene(entry.config as AuthoredTalkQuestSceneConfig);
  }
}

function resolveJsonDirectory(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const distJsonDir = path.join(currentDir, "json");
  if (fs.existsSync(distJsonDir)) return distJsonDir;
  return path.join(process.cwd(), "src", "social", "questGraphs", "data", "json");
}

export function loadAuthoredQuestArcsFromJson(): QuestArcDefinition[] {
  const jsonDir = resolveJsonDirectory();
  const files = fs.readdirSync(jsonDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  return files.map((fileName) => {
    const fullPath = path.join(jsonDir, fileName);
    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = parseAuthoredArcJson(JSON.parse(raw), fileName);
    const scenes = Object.fromEntries(parsed.scenes.map((entry) => {
      const scene = buildScene(entry);
      return [scene.id, scene];
    })) as QuestArcDefinition["scenes"];

    return {
      id: parsed.meta.id,
      title: parsed.meta.title,
      summary: parsed.meta.summary,
      zoneIds: parsed.meta.zoneIds,
      tags: parsed.meta.tags,
      startingSceneId: parsed.meta.startingSceneId,
      scenes,
    };
  });
}
