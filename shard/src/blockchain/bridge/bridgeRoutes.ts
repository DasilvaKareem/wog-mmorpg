import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticateRequest, controlsWallet } from "../../auth/auth.js";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHARACTER_CONTRACT,
  BRIDGE_ENABLED,
  SKALE_BASE_CHAIN_ID,
  SKALE_BRIDGE_ADAPTER_CONTRACT,
  bridgeContractsConfigured,
} from "./bridgeConfig.js";
import {
  BridgeError,
  buildClaimResponse,
  exportCharacterToBase,
  getBridgeOperation,
  getCharacterBridgeStatus,
  importCharacterToSkale,
  listBridgeOperationsByWallet,
  listRefundableBridges,
} from "./bridgeService.js";
import { loadCharacter } from "../../character/characterStore.js";

interface ExportBody {
  walletAddress: string;
  characterName: string;
  baseRecipient: string;
}

interface ImportBody {
  walletAddress: string;
  baseTokenId: string;
  skaleRecipient: string;
  characterName?: string;
  characterClassId?: string;
  freshMint?: boolean;
}

function authWallet(req: FastifyRequest): string {
  return String((req as any).walletAddress ?? "").toLowerCase();
}

function isAddress(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function bridgeStatusPayload(record: any) {
  return {
    bridgeId: record.bridgeId,
    direction: record.direction,
    walletAddress: record.walletAddress,
    sourceChainId: record.sourceChainId,
    destinationChainId: record.destinationChainId,
    sourceTokenId: record.sourceTokenId,
    destinationTokenId: record.destinationTokenId,
    recipientAddress: record.recipientAddress,
    status: record.status,
    burnTxHash: record.burnTxHash,
    redeemTxHash: record.redeemTxHash,
    metadataURI: record.metadataURI,
    claimDigest: record.claimDigest,
    claimExpiresAt: record.claimExpiresAt,
    characterName: record.characterName,
    characterClassId: record.characterClassId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastError: record.lastError,
  };
}

function handleBridgeError(reply: any, err: unknown): void {
  if (err instanceof BridgeError) {
    const status =
      err.code === "disabled" || err.code === "not_configured"
        ? 503
        : err.code === "rate_limit_wallet" || err.code === "rate_limit_global"
          ? 429
          : err.code === "conflict"
            ? 409
            : err.code === "not_found"
              ? 404
              : 400;
    reply.code(status).send({ error: err.message, code: err.code });
    return;
  }
  reply.code(500).send({ error: (err as Error)?.message ?? "Internal error" });
}

export function registerBridgeRoutes(server: FastifyInstance): void {
  /** Public meta endpoint: lets the client know whether the bridge is live. */
  server.get("/bridge/info", async () => {
    return {
      enabled: BRIDGE_ENABLED && bridgeContractsConfigured(),
      chains: {
        skale: {
          chainId: SKALE_BASE_CHAIN_ID,
          adapterContract: SKALE_BRIDGE_ADAPTER_CONTRACT || null,
        },
        base: {
          chainId: BASE_MAINNET_CHAIN_ID,
          characterContract: BASE_MAINNET_CHARACTER_CONTRACT || null,
        },
      },
    };
  });

  server.post<{ Body: ExportBody }>(
    "/bridge/export",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const auth = authWallet(req);
      const { walletAddress, characterName, baseRecipient } = req.body ?? ({} as ExportBody);
      if (!walletAddress || !characterName || !isAddress(baseRecipient)) {
        reply.code(400).send({ error: "walletAddress, characterName, and baseRecipient required" });
        return;
      }
      if (!(await controlsWallet(auth, walletAddress))) {
        reply.code(403).send({ error: "Not authorized for that wallet" });
        return;
      }
      const character = await loadCharacter(walletAddress, characterName);
      if (!character) {
        reply.code(404).send({ error: `Character "${characterName}" not found` });
        return;
      }
      if (!character.characterTokenId) {
        reply.code(400).send({ error: "Character has no characterTokenId yet (mint pending?)" });
        return;
      }
      try {
        const record = await exportCharacterToBase({
          walletAddress: walletAddress.toLowerCase(),
          characterTokenId: character.characterTokenId,
          characterName,
          characterClassId: character.classId,
          baseRecipient: baseRecipient.toLowerCase(),
          custodialFlow: false, // skeleton: external-wallet flow only; custodial coming next
        });
        reply.send(bridgeStatusPayload(record));
      } catch (err) {
        handleBridgeError(reply, err);
      }
    },
  );

  server.post<{ Body: ImportBody }>(
    "/bridge/import",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const auth = authWallet(req);
      const { walletAddress, baseTokenId, skaleRecipient, characterName, characterClassId, freshMint } =
        req.body ?? ({} as ImportBody);
      if (!walletAddress || !baseTokenId || !isAddress(skaleRecipient)) {
        reply.code(400).send({ error: "walletAddress, baseTokenId, and skaleRecipient required" });
        return;
      }
      if (!(await controlsWallet(auth, walletAddress))) {
        reply.code(403).send({ error: "Not authorized for that wallet" });
        return;
      }
      try {
        const record = await importCharacterToSkale({
          walletAddress: walletAddress.toLowerCase(),
          baseTokenId,
          skaleRecipient: skaleRecipient.toLowerCase(),
          characterName,
          characterClassId,
          custodialFlow: false,
          freshMint: Boolean(freshMint),
        });
        reply.send(bridgeStatusPayload(record));
      } catch (err) {
        handleBridgeError(reply, err);
      }
    },
  );

  server.get<{ Params: { bridgeId: string } }>(
    "/bridge/status/:bridgeId",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const record = await getBridgeOperation(req.params.bridgeId);
      if (!record) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      const auth = authWallet(req);
      if (!(await controlsWallet(auth, record.walletAddress))) {
        reply.code(403).send({ error: "Not authorized" });
        return;
      }
      reply.send(bridgeStatusPayload(record));
    },
  );

  server.get<{ Params: { bridgeId: string } }>(
    "/bridge/claim/:bridgeId",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const record = await getBridgeOperation(req.params.bridgeId);
      if (!record) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      const auth = authWallet(req);
      if (!(await controlsWallet(auth, record.walletAddress))) {
        reply.code(403).send({ error: "Not authorized" });
        return;
      }
      if (record.status !== "claim_signed") {
        reply.code(409).send({
          error: `Claim not ready (status=${record.status})`,
          status: record.status,
        });
        return;
      }
      try {
        const claim = await buildClaimResponse(record.bridgeId);
        if (!claim) {
          reply.code(404).send({ error: "Claim payload not available" });
          return;
        }
        reply.send({
          claim: {
            sourceTokenId: claim.claim.sourceTokenId.toString(),
            destinationTokenId: claim.claim.destinationTokenId.toString(),
            recipient: claim.claim.recipient,
            sourceChainId: Number(claim.claim.sourceChainId),
            destinationChainId: Number(claim.claim.destinationChainId),
            metadataURI: claim.claim.metadataURI,
            nonce: claim.claim.nonce,
            expiresAt: Number(claim.claim.expiresAt),
          },
          signature: claim.signature,
          digest: claim.digest,
          verifyingContract: claim.verifyingContract,
        });
      } catch (err) {
        handleBridgeError(reply, err);
      }
    },
  );

  server.get<{ Querystring: { wallet: string } }>(
    "/bridge/history",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const wallet = req.query.wallet;
      if (!isAddress(wallet)) {
        reply.code(400).send({ error: "wallet query param required" });
        return;
      }
      const auth = authWallet(req);
      if (!(await controlsWallet(auth, wallet))) {
        reply.code(403).send({ error: "Not authorized" });
        return;
      }
      const records = await listBridgeOperationsByWallet(wallet);
      reply.send({ history: records.map(bridgeStatusPayload) });
    },
  );

  server.get<{
    Querystring: { wallet: string; characterName: string };
  }>(
    "/bridge/character-status",
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const { wallet, characterName } = req.query;
      if (!isAddress(wallet) || !characterName) {
        reply.code(400).send({ error: "wallet and characterName required" });
        return;
      }
      const auth = authWallet(req);
      if (!(await controlsWallet(auth, wallet))) {
        reply.code(403).send({ error: "Not authorized" });
        return;
      }
      const status = await getCharacterBridgeStatus(wallet, characterName);
      reply.send(status);
    },
  );

  /** Admin-only: list bridges with expired claims (for ops dashboards). */
  server.get("/bridge/admin/refundable", async (req, reply) => {
    const adminSecret = req.headers["x-admin-secret"];
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
      reply.code(403).send({ error: "admin only" });
      return;
    }
    const records = await listRefundableBridges();
    reply.send({ refundable: records.map(bridgeStatusPayload) });
  });
}
