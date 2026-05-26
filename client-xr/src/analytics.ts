import posthog from "posthog-js";

const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;

if (key) {
  posthog.init(key, { api_host: host ?? "https://us.i.posthog.com", defaults: "2026-01-30" });
}

// ── Auth / Acquisition ───────────────────────────────────────────────────────

export function trackXRUserConnected(props: { walletAddress: string; method: string }) {
  posthog.identify(props.walletAddress);
  posthog.capture("xr_user_connected", props);
}

export function trackXRUserAutoConnected(walletAddress: string) {
  posthog.identify(walletAddress);
  posthog.capture("xr_user_auto_connected", { walletAddress });
}

export function trackXRUserDisconnected(walletAddress: string | null) {
  posthog.capture("xr_user_disconnected", { walletAddress });
  posthog.reset();
}

export function trackXRSignupStarted(mode: "signup" | "login") {
  posthog.capture("xr_signup_started", { mode });
}

export function trackXRAuthMethodSelected(method: string) {
  posthog.capture("xr_auth_method_selected", { method });
}

export function trackXRAuthCodeSent(method: string) {
  posthog.capture("xr_auth_code_sent", { method });
}

export function trackXRAuthFailed(method: string, error: string) {
  posthog.capture("xr_auth_failed", { method, error: error.slice(0, 200) });
}

// ── Activation ───────────────────────────────────────────────────────────────

export function trackXRCharacterSelected(props: { walletAddress: string; name: string; classId: string; raceId: string; isReconnect: boolean }) {
  posthog.capture("xr_character_selected", props);
}

export function trackXRCharacterCreated(props: { walletAddress: string; name: string; classId: string; raceId: string }) {
  posthog.capture("xr_character_created", props);
}

export function trackXRGameEntered(props: { walletAddress: string; entityId: string; zoneId: string; characterName: string }) {
  posthog.capture("xr_game_entered", props);
}

// ── Session depth ────────────────────────────────────────────────────────────

export function trackXRSessionStarted(walletAddress: string) {
  posthog.capture("xr_session_started", { walletAddress });
}

export function trackXRSessionDuration(durationMs: number, walletAddress: string | null) {
  posthog.capture("xr_session_duration", { duration_ms: durationMs, duration_min: Math.round(durationMs / 60_000), walletAddress });
}

export function trackXRVRSessionStarted() {
  posthog.capture("xr_vr_session_started");
}

export function trackXRVRSessionEnded(durationMs: number) {
  posthog.capture("xr_vr_session_ended", { duration_ms: durationMs, duration_min: Math.round(durationMs / 60_000) });
}

// ── Engagement ───────────────────────────────────────────────────────────────

export function trackXRPanelOpened(panelId: string) {
  posthog.capture("xr_panel_opened", { panel: panelId });
}

export function trackXRNpcDialogOpened(npcType: string, npcName?: string) {
  posthog.capture("xr_npc_dialog_opened", { npc_type: npcType, npc_name: npcName });
}

export function trackXRQuestAccepted(questId: string) {
  posthog.capture("xr_quest_accepted", { quest_id: questId });
}

export function trackXRQuestCompleted(questId: string, questTitle: string) {
  posthog.capture("xr_quest_completed", { quest_id: questId, quest_title: questTitle });
}

export function trackXRQuestAbandoned(questId: string, questTitle: string) {
  posthog.capture("xr_quest_abandoned", { quest_id: questId, quest_title: questTitle });
}

export function trackXRAgentTabSwitched(tab: string) {
  posthog.capture("xr_agent_tab_switched", { tab });
}

export function trackXRAgentInstructionSent(props: { isSlashCommand: boolean; command?: string }) {
  posthog.capture("xr_agent_instruction_sent", props);
}
