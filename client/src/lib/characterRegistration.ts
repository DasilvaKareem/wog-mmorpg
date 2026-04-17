export interface RegistrationCharacterLike {
  tokenId?: string | null;
  characterTokenId?: string | null;
  agentId?: string | null;
  agentRegistrationTxHash?: string | null;
  chainRegistrationStatus?: string | null;
  bootstrapStatus?: string | null;
}

const ACTIVE_BOOTSTRAP_STATUSES = new Set([
  "queued",
  "pending_mint",
  "mint_confirmed",
  "identity_pending",
  "failed_retryable",
]);

export function isRegistrationSettled(character: RegistrationCharacterLike | null | undefined): boolean {
  if (!character) return false;
  if (character.chainRegistrationStatus !== "registered") return false;
  if (ACTIVE_BOOTSTRAP_STATUSES.has(character.bootstrapStatus ?? "")) return false;
  return Boolean(character.agentId || character.agentRegistrationTxHash);
}

export function getRegistrationStatusLabel(
  character: RegistrationCharacterLike | null | undefined,
): string {
  // Client source of truth is shard character state (Postgres-backed).
  if (isRegistrationSettled(character)) {
    return "Registered on-chain";
  }
  const status = character?.bootstrapStatus ?? character?.chainRegistrationStatus ?? null;
  switch (status) {
    case "queued":
      return "Queued for bootstrap";
    case "pending_mint":
      return "Minting character NFT";
    case "mint_confirmed":
      return "Character minted";
    case "identity_pending":
      return "Registering agent identity";
    case "failed_retryable":
      return "Retrying registration";
    case "failed_permanent":
      return "Registration failed";
    case "unregistered":
      return "Not registered on-chain";
    default:
      return "Identity registration pending";
  }
}

export function resolveRegistrationTxHash(params: {
  character: RegistrationCharacterLike | null | undefined;
}): string | null {
  const { character } = params;
  if (!isRegistrationSettled(character)) return null;
  return character?.agentRegistrationTxHash ?? null;
}
