import { agentManager } from "../agents/agentManager.js";
import { getEntity, type Entity } from "../world/zoneRuntime.js";
import { getZoneEvents, type ZoneEvent } from "../world/zoneEvents.js";
import { getPartyLeaderIdByPartyId, getPartyMemberIdsByPartyId } from "./partySystem.js";

const PARTY_FOLLOW_DISTANCE = 60;

export interface PartyReportMember {
  entityId: string;
  name: string;
  zoneId: string | null;
  walletAddress: string | null;
  isLeader: boolean;
  isLive: boolean;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
  classId: string | null;
  distanceToLeader: number | null;
  nearLeader: boolean | null;
}

export interface PartyCoordinationReport {
  partyId: string;
  leader: {
    entityId: string | null;
    name: string | null;
    zoneId: string | null;
    walletAddress: string | null;
  };
  members: PartyReportMember[];
  counts: {
    totalMembers: number;
    liveMembers: number;
    followerCount: number;
    sameZoneFollowers: number;
    nearLeaderFollowers: number;
    offZoneFollowers: number;
    spacingFailures: number;
    cohesionFailures: number;
  };
  ratios: {
    cohesionPct: number;
    leaderCallAssistPct: number;
    leaderSupportPct: number;
    followActivityPct: number;
  };
  metrics: {
    aggregated: Record<string, number>;
    top: Array<{ kind: string; count: number }>;
    assistLeaderTarget: number;
    assistPartyTag: number;
    followLeader: number;
    healLeader: number;
    healAlly: number;
    buffLeader: number;
    buffAlly: number;
    partyTechnique: number;
    assistTotal: number;
    supportTotal: number;
    leaderSupportTotal: number;
  };
  recentEvents: Array<{
    id: string;
    timestamp: number;
    zoneId: string;
    message: string;
    entityId?: string;
    entityName?: string;
    data?: Record<string, unknown>;
  }>;
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toReportMember(memberId: string, leader: Entity | null, leaderId?: string): PartyReportMember {
  const member = getEntity(memberId) as Entity | null;
  if (!member) {
    return {
      entityId: memberId,
      name: "Offline",
      zoneId: null,
      walletAddress: null,
      isLeader: memberId === leaderId,
      isLive: false,
      level: null,
      hp: null,
      maxHp: null,
      classId: null,
      distanceToLeader: null,
      nearLeader: null,
    };
  }

  const distanceToLeader = leader && member.id !== leader.id
    ? Math.hypot(member.x - leader.x, member.y - leader.y)
    : 0;
  const nearLeader = leader && member.id !== leader.id
    ? member.region === leader.region && distanceToLeader <= PARTY_FOLLOW_DISTANCE
    : null;

  return {
    entityId: member.id,
    name: member.name,
    zoneId: member.region ?? null,
    walletAddress: member.walletAddress ?? null,
    isLeader: member.id === leaderId,
    isLive: true,
    level: member.level ?? null,
    hp: member.hp ?? null,
    maxHp: member.maxHp ?? null,
    classId: member.classId ?? null,
    distanceToLeader: member.id !== leaderId ? Math.round(distanceToLeader ?? 0) : 0,
    nearLeader,
  };
}

function collectRecentPartyEvents(memberSet: Set<string>, liveMembers: PartyReportMember[]): Array<{
  id: string;
  timestamp: number;
  zoneId: string;
  message: string;
  entityId?: string;
  entityName?: string;
  data?: Record<string, unknown>;
}> {
  const zoneIds = Array.from(new Set(
    liveMembers
      .map((member) => member.zoneId)
      .filter((zoneId): zoneId is string => !!zoneId),
  ));
  const events: ZoneEvent[] = [];
  for (const zoneId of zoneIds) {
    events.push(...getZoneEvents(zoneId, 200));
  }

  return events
    .filter((event) => event.type === "party" && (!!event.entityId && memberSet.has(event.entityId)))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12)
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      zoneId: event.zoneId,
      message: event.message,
      entityId: event.entityId,
      entityName: event.entityName,
      data: event.data,
    }));
}

export function buildPartyCoordinationReport(partyId: string): PartyCoordinationReport | null {
  const memberIds = getPartyMemberIdsByPartyId(partyId);
  if (!memberIds || memberIds.length === 0) return null;

  const leaderId = getPartyLeaderIdByPartyId(partyId);
  const leader = leaderId ? (getEntity(leaderId) as Entity | null) : null;
  const members = memberIds.map((memberId) => toReportMember(memberId, leader, leaderId));
  const memberSet = new Set(memberIds);
  const liveMembers = members.filter((member) => member.isLive);
  const followers = liveMembers.filter((member) => member.entityId !== leaderId);
  const sameZoneFollowers = leader
    ? followers.filter((member) => member.zoneId === leader.region)
    : [];
  const nearLeaderFollowers = sameZoneFollowers.filter((member) => member.nearLeader === true);
  const offZoneFollowers = leader
    ? followers.filter((member) => member.zoneId !== leader.region)
    : followers;
  const spacingFailures = Math.max(0, sameZoneFollowers.length - nearLeaderFollowers.length);
  const cohesionFailures = offZoneFollowers.length + spacingFailures;

  const runnerMetrics = agentManager.listRunners()
    .map((runner) => runner.getSnapshot())
    .filter((snapshot) => !!snapshot.running && !!snapshot.entityId && memberSet.has(snapshot.entityId));

  const aggregatedPartyMetrics: Record<string, number> = {};
  for (const snapshot of runnerMetrics) {
    const metrics = snapshot.telemetry?.party ?? {};
    for (const [kind, count] of Object.entries(metrics)) {
      aggregatedPartyMetrics[kind] = (aggregatedPartyMetrics[kind] ?? 0) + Number(count ?? 0);
    }
  }

  const assistLeaderTarget = aggregatedPartyMetrics["assist-leader-target"] ?? 0;
  const assistPartyTag = aggregatedPartyMetrics["assist-party-tag"] ?? 0;
  const followLeader = aggregatedPartyMetrics["follow-leader"] ?? 0;
  const healLeader = aggregatedPartyMetrics["heal-leader"] ?? 0;
  const healAlly = aggregatedPartyMetrics["heal-ally"] ?? 0;
  const buffLeader = aggregatedPartyMetrics["buff-leader"] ?? 0;
  const buffAlly = aggregatedPartyMetrics["buff-ally"] ?? 0;
  const partyTechnique = aggregatedPartyMetrics["party-technique"] ?? 0;
  const assistTotal = assistLeaderTarget + assistPartyTag;
  const supportTotal = healLeader + healAlly + buffLeader + buffAlly + partyTechnique;
  const leaderSupportTotal = healLeader + buffLeader;

  return {
    partyId,
    leader: {
      entityId: leaderId ?? null,
      name: leader?.name ?? null,
      zoneId: leader?.region ?? null,
      walletAddress: leader?.walletAddress ?? null,
    },
    members,
    counts: {
      totalMembers: memberIds.length,
      liveMembers: liveMembers.length,
      followerCount: followers.length,
      sameZoneFollowers: sameZoneFollowers.length,
      nearLeaderFollowers: nearLeaderFollowers.length,
      offZoneFollowers: offZoneFollowers.length,
      spacingFailures,
      cohesionFailures,
    },
    ratios: {
      cohesionPct: roundPct(nearLeaderFollowers.length, Math.max(1, followers.length)),
      leaderCallAssistPct: roundPct(assistLeaderTarget, Math.max(1, assistTotal)),
      leaderSupportPct: roundPct(leaderSupportTotal, Math.max(1, supportTotal)),
      followActivityPct: roundPct(followLeader, Math.max(1, followLeader + assistTotal)),
    },
    metrics: {
      aggregated: aggregatedPartyMetrics,
      top: Object.entries(aggregatedPartyMetrics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([kind, count]) => ({ kind, count })),
      assistLeaderTarget,
      assistPartyTag,
      followLeader,
      healLeader,
      healAlly,
      buffLeader,
      buffAlly,
      partyTechnique,
      assistTotal,
      supportTotal,
      leaderSupportTotal,
    },
    recentEvents: collectRecentPartyEvents(memberSet, liveMembers),
  };
}
