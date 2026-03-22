#!/usr/bin/env npx tsx
/**
 * Creates the WoG Investor Dashboard in PostHog programmatically.
 *
 * Usage:
 *   POSTHOG_PERSONAL_API_KEY=phx_xxx npx tsx scripts/setup-posthog-dashboard.ts
 *
 * Get your personal API key from:
 *   https://us.posthog.com/settings/user-api-keys
 */

const API_HOST = "https://us.posthog.com";
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const EXISTING_DASHBOARD_ID = process.env.POSTHOG_DASHBOARD_ID
  ? Number(process.env.POSTHOG_DASHBOARD_ID)
  : null;

if (!API_KEY) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY.\n" +
      "Create one at: https://us.posthog.com/settings/user-api-keys\n" +
      "Then run: POSTHOG_PERSONAL_API_KEY=phx_xxx npx tsx scripts/setup-posthog-dashboard.ts"
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_HOST}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Resolve project ID ───────────────────────────────────────────────────────

async function getProjectId(): Promise<number> {
  const data = await api<{ results: { id: number; name: string }[] }>(
    "GET",
    "/api/projects/"
  );
  if (data.results.length === 0) throw new Error("No PostHog projects found.");
  const project = data.results[0];
  console.log(`Using project: "${project.name}" (ID: ${project.id})`);
  return project.id;
}

// ── Insight definitions ──────────────────────────────────────────────────────

function dauInsight() {
  return {
    name: "DAU (Daily Active Users)",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          {
            event: "$pageview",
            kind: "EventsNode",
            math: "dau",
            name: "DAU",
          },
        ],
        interval: "day",
        dateRange: { date_from: "-30d" },
        trendsFilter: { display: "ActionsLineGraph" },
      },
    },
  };
}

function d1RetentionInsight() {
  return {
    name: "D1 Retention (% returning next day)",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "RetentionQuery",
        retentionFilter: {
          retentionType: "retention_first_time",
          totalIntervals: 7,
          period: "Day",
        },
        dateRange: { date_from: "-30d" },
      },
    },
  };
}

function sessionsPerUserInsight() {
  return {
    name: "Avg Sessions per User per Day",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          {
            event: "session_started",
            kind: "EventsNode",
            math: "total",
            name: "Total Sessions",
          },
          {
            event: "session_started",
            kind: "EventsNode",
            math: "dau",
            name: "Unique Users",
          },
        ],
        interval: "day",
        dateRange: { date_from: "-30d" },
        trendsFilter: {
          display: "ActionsLineGraph",
          formula: "A / B",
        },
      },
    },
  };
}

function agentInteractionRateInsight() {
  return {
    name: "% Users Interacting with Agent Daily",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          {
            event: "give_instruction",
            kind: "EventsNode",
            math: "dau",
            name: "Users Giving Instructions",
          },
          {
            event: "$pageview",
            kind: "EventsNode",
            math: "dau",
            name: "DAU",
          },
        ],
        interval: "day",
        dateRange: { date_from: "-30d" },
        trendsFilter: {
          display: "ActionsLineGraph",
          formula: "A / B * 100",
        },
      },
    },
  };
}

function avgAgentActionsInsight() {
  return {
    name: "Avg Agent Actions per Day",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          {
            event: "agent_progress_tick",
            kind: "EventsNode",
            math: "total",
            name: "Agent Ticks",
          },
          {
            event: "agent_task_started",
            kind: "EventsNode",
            math: "total",
            name: "Agent Deploys",
          },
          {
            event: "agent_task_completed",
            kind: "EventsNode",
            math: "total",
            name: "Agent Completions",
          },
        ],
        interval: "day",
        dateRange: { date_from: "-30d" },
        trendsFilter: { display: "ActionsLineGraph" },
      },
    },
  };
}

function characterCreationFunnelInsight() {
  return {
    name: "Signup → Character → Agent Funnel",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        series: [
          { event: "user_signed_up", kind: "EventsNode", name: "Signed Up" },
          {
            event: "character_created",
            kind: "EventsNode",
            name: "Created Character",
          },
          {
            event: "agent_task_started",
            kind: "EventsNode",
            name: "Deployed Agent",
          },
          {
            event: "give_instruction",
            kind: "EventsNode",
            name: "First Instruction",
          },
        ],
        dateRange: { date_from: "-30d" },
        funnelsFilter: {
          funnelWindowInterval: 1,
          funnelWindowIntervalUnit: "day",
        },
      },
    },
  };
}

function emotionalAttachmentInsight() {
  return {
    name: "Emotional Attachment Score (views + instructions per user)",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          {
            event: "view_character",
            kind: "EventsNode",
            math: "total",
            name: "Character Views",
          },
          {
            event: "give_instruction",
            kind: "EventsNode",
            math: "total",
            name: "Instructions Given",
          },
          {
            event: "open_game",
            kind: "EventsNode",
            math: "dau",
            name: "DAU",
          },
        ],
        interval: "day",
        dateRange: { date_from: "-30d" },
        trendsFilter: {
          display: "ActionsLineGraph",
          formula: "(A + B) / C",
        },
      },
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const projectId = await getProjectId();
  const base = `/api/projects/${projectId}`;

  let dashboardId = EXISTING_DASHBOARD_ID;

  if (!dashboardId) {
    console.log("\nCreating dashboard...");
    const dashboard = await api<{ id: number }>(
      "POST",
      `${base}/dashboards/`,
      {
        name: "Investor Dashboard — World of Geneva",
        description:
          "The story: people are emotionally attached to something that plays itself.\n" +
          "DAU · D1 Retention · Agent Engagement · Conversion Funnel",
        pinned: true,
      }
    );
    dashboardId = dashboard.id;
    console.log(`  Dashboard created (ID: ${dashboardId})`);
  } else {
    console.log(`\nUsing existing dashboard (ID: ${dashboardId})`);
  }

  const insights = [
    dauInsight(),
    d1RetentionInsight(),
    sessionsPerUserInsight(),
    agentInteractionRateInsight(),
    avgAgentActionsInsight(),
    characterCreationFunnelInsight(),
    emotionalAttachmentInsight(),
  ];

  let created = 0;
  let failed = 0;

  for (const insight of insights) {
    try {
      console.log(`  Creating insight: ${insight.name}`);
      await api("POST", `${base}/insights/`, {
        ...insight,
        dashboards: [dashboardId],
      });
      created++;
    } catch (err: any) {
      failed++;
      console.error(`  FAILED: ${insight.name} — ${err.message.slice(0, 200)}`);
    }
  }

  const url = `${API_HOST}/project/${projectId}/dashboard/${dashboardId}`;
  console.log(`\n${created} insights created, ${failed} failed.`);
  console.log(`Dashboard ready: ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
