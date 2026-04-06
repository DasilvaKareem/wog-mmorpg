export interface RegistrationCharacterLike {
  tokenId?: string | null;
  characterTokenId?: string | null;
  agentId?: string | null;
  agentRegistrationTxHash?: string | null;
  chainRegistrationStatus?: string | null;
  bootstrapStatus?: string | null;
}

export interface RegistrationIdentityLike {
  characterTokenId?: string | null;
  registrationTxHash?: string | null;
  onChainRegistered?: boolean;
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
  identity: RegistrationIdentityLike | null | undefined,
): string {
  if (isRegistrationSettled(character) && (identity?.onChainRegistered ?? true)) {
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
  identity: RegistrationIdentityLike | null | undefined;
  resolvedAgentId?: string | null;
}): string | null {
  const { character, identity, resolvedAgentId } = params;
  if (!isRegistrationSettled(character)) return null;

  if (!resolvedAgentId) {
    return character?.agentRegistrationTxHash ?? null;
  }

  const characterTokenId = character?.characterTokenId ?? character?.tokenId ?? null;
  const identityMatchesCharacter = Boolean(
    identity
    && (!characterTokenId
      || identity.characterTokenId == null
      || identity.characterTokenId === characterTokenId)
  );

  if (!identityMatchesCharacter) return null;
  return identity?.registrationTxHash ?? null;
}
