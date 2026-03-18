/**
 * PostHog event tracking helpers.
 * Centralises event names so dashboards and code stay in sync.
 */
import posthog from "posthog-js";

// ── Core Events ──────────────────────────────────────────────────────────────

export function trackUserSignedUp(method: string, walletAddress: string) {
  posthog.capture("user_signed_up", { method, wallet_address: walletAddress });
  posthog.identify(walletAddress);
}

export function trackCharacterCreated(props: {
  name: string;
  race: string;
  class: string;
  origin: string;
  walletAddress: string;
}) {
  posthog.capture("character_created", props);
}

export function trackSessionStarted(walletAddress: string) {
  posthog.capture("session_started", { wallet_address: walletAddress });
  posthog.identify(walletAddress);
}

// ── Agent Events ─────────────────────────────────────────────────────────────

export function trackAgentTaskStarted(props: {
  walletAddress: string;
  characterName?: string;
  zoneId?: string;
}) {
  posthog.capture("agent_task_started", props);
}

export function trackAgentTaskCompleted(props: {
  walletAddress: string;
  entityId?: string;
  zoneId?: string;
}) {
  posthog.capture("agent_task_completed", props);
}

export function trackAgentProgressTick(props: {
  walletAddress: string;
  focus?: string;
  level?: number;
  zoneId?: string;
}) {
  posthog.capture("agent_progress_tick", props);
}

// ── Engagement Events ────────────────────────────────────────────────────────

export function trackViewCharacter(props: {
  characterName: string;
  level: number;
  race: string;
  class: string;
}) {
  posthog.capture("view_character", props);
}

export function trackGiveInstruction(props: {
  walletAddress: string;
  message: string;
}) {
  posthog.capture("give_instruction", {
    wallet_address: props.walletAddress,
    message_length: props.message.length,
    is_slash_command: props.message.startsWith("/"),
  });
}

export function trackOpenGame(walletAddress: string | null) {
  posthog.capture("open_game", { wallet_address: walletAddress });
}
