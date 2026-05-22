// Post-damage death + reward handling. Called once whenever an entity's HP
// drops to 0 from a basic attack or technique. Both call sites in the tick
// loop previously inlined nearly identical 78-line blocks for this — the
// only differences were variable names. Centralising avoids drift between
// the two paths (e.g. quest progress would have to be patched twice).
//
// What it does (in order):
//   1. Resolve the tagger → XP recipient (first-hit wins, falls back to killer)
//   2. Log a "kill" zone event
//   3. Increment kill count + write diary entry for the recipient
//   4. Call handlePlayerDeath or handleMobDeath
//   5. Advance kill-type quest progress for the recipient
//   6. Clear killer's order + sticky user-engage target
//   7. Award party-shared XP

import type { Entity, ZoneState } from "../world/zoneRuntime.js";
import {
  awardPartyXp,
  handleMobDeath,
  handlePlayerDeath,
} from "../world/zoneRuntime.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { logDiary, narrativeKill } from "../social/diary.js";
import { markQuestsDirty } from "../social/questPersistence.js";
import { QUEST_CATALOG, doesKillCountForQuest } from "../social/questSystem.js";

export function onTargetKilled(killer: Entity, target: Entity, zone: ZoneState): void {
  // Tagger gets all rewards (first-hit wins). Falls back to the killer when
  // there's no tagger or the tagger isn't a player.
  const tagger = (target.taggedBy && target.taggedBy !== killer.id)
    ? zone.entities.get(target.taggedBy)
    : undefined;
  const xpRecipient = (tagger && tagger.type === "player") ? tagger : killer;

  logZoneEvent({
    zoneId: zone.zoneId,
    type: "kill",
    tick: zone.tick,
    message: `${xpRecipient.name} has slain ${target.name}!`,
    entityId: xpRecipient.id,
    entityName: xpRecipient.name,
    targetId: target.id,
    targetName: target.name,
    data: { xpReward: target.xpReward ?? 0 },
  });

  if (xpRecipient.type === "player") {
    xpRecipient.kills = (xpRecipient.kills ?? 0) + 1;

    if (xpRecipient.walletAddress) {
      const { headline, narrative } = narrativeKill(
        xpRecipient.name,
        xpRecipient.raceId,
        xpRecipient.classId,
        zone.zoneId,
        target.name,
        target.xpReward ?? 0,
      );
      logDiary(
        xpRecipient.walletAddress,
        xpRecipient.name,
        zone.zoneId,
        xpRecipient.x,
        xpRecipient.y,
        "kill",
        headline,
        narrative,
        {
          targetName: target.name,
          targetType: target.type,
          xpReward: target.xpReward ?? 0,
        },
      );
    }
  }

  if (target.type === "player") {
    handlePlayerDeath(target, zone.zoneId);
  } else {
    handleMobDeath(target, xpRecipient, zone);

    // Quest progress for kill-type objectives (recipient only — prevents
    // griefing where someone else's kill advances your quest).
    if (xpRecipient.type === "player" && xpRecipient.activeQuests) {
      for (const activeQuest of xpRecipient.activeQuests) {
        const questDef = QUEST_CATALOG.find((q) => q.id === activeQuest.questId);
        if (questDef && doesKillCountForQuest(questDef, target.type, target.name)) {
          activeQuest.progress++;
          markQuestsDirty(xpRecipient);
          console.log(
            `[quest] ${xpRecipient.name} progress: ${questDef.title} (${activeQuest.progress}/${questDef.objective.count})`,
          );
          logZoneEvent({
            zoneId: zone.zoneId,
            type: "quest-progress",
            tick: zone.tick,
            message: `${xpRecipient.name}: ${questDef.title} (${activeQuest.progress}/${questDef.objective.count})`,
            entityId: xpRecipient.id,
            entityName: xpRecipient.name,
            data: {
              questId: activeQuest.questId,
              questTitle: questDef.title,
              progress: activeQuest.progress,
              required: questDef.objective.count,
              complete: activeQuest.progress >= questDef.objective.count,
            },
          });
        }
      }
    }
  }

  killer.order = undefined;
  if (killer.userEngagedAt?.targetId === target.id) {
    killer.userEngagedAt = undefined;
  }

  awardPartyXp(zone, xpRecipient, target.xpReward ?? 0, target.level);
}
