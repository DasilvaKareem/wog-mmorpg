/**
 * Public surface for the NFT bridge module.
 * Server.ts should call `registerBridgeRoutes(server)` + `startBridgeWorkers()`.
 */
export { registerBridgeRoutes } from "./bridgeRoutes.js";
export { startBridgeEventListener, stopBridgeEventListener } from "./bridgeEventListener.js";
export { BridgeError, getCharacterBridgeStatus } from "./bridgeService.js";
export { BRIDGE_ENABLED, bridgeContractsConfigured } from "./bridgeConfig.js";
export { getBridgeSignerAddress } from "./bridgeClaimSigner.js";

import { startBridgeEventListener } from "./bridgeEventListener.js";
import { BRIDGE_ENABLED, bridgeContractsConfigured } from "./bridgeConfig.js";

/** Boot-time entrypoint. Idempotent — safe to call from server.ts. */
export async function startBridgeWorkers(): Promise<void> {
  if (!BRIDGE_ENABLED) {
    console.log("[bridge] disabled (BRIDGE_ENABLED=false)");
    return;
  }
  if (!bridgeContractsConfigured()) {
    console.warn(
      "[bridge] BRIDGE_ENABLED=true but contracts not configured — bridge will be partially online",
    );
    return;
  }
  await startBridgeEventListener();
  console.log("[bridge] workers started");
}
