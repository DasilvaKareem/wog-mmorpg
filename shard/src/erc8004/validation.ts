export interface AgentValidation {
  requestHash: string;
  validator: string;
  claimType: string;
  response: number;
  lastUpdated: number;
  active: boolean;
}

export async function publishValidationClaim(
  _agentId: string | bigint,
  _claim: string
): Promise<string | null> {
  return null;
}

export async function getValidationClaims(_agentId: string | bigint): Promise<AgentValidation[]> {
  return [];
}

export async function isValidationClaimActive(
  _agentId: string | bigint,
  _claim: string
): Promise<boolean> {
  return false;
}
