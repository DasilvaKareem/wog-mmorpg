import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { setSession, deleteSession } from "../session.js";

export function registerAuthTools(server: McpServer): void {
  /**
   * Step 1: Get a challenge message to sign with your wallet.
   * The returned message + timestamp must be signed off-chain.
   */
  server.registerTool(
    "auth_get_challenge",
    {
      description:
        "Get a challenge message to sign with your wallet. Returns a message string and timestamp. Sign the message off-chain, then call auth_verify_signature to receive a session token.",
      inputSchema: {
        walletAddress: z
          .string()
          .describe("Your Ethereum wallet address (0x...)"),
      },
    },
    async ({ walletAddress }, extra) => {
      const data = await shard.get<{
        message: string;
        timestamp: number;
        wallet: string;
      }>(`/auth/challenge?wallet=${walletAddress}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  /**
   * Step 2: Submit the signed challenge. Stores the JWT in the session.
   */
  server.registerTool(
    "auth_verify_signature",
    {
      description:
        "Verify your wallet signature and authenticate. Provide the walletAddress, the signature of the challenge message, and the timestamp from auth_get_challenge. Stores a session token so subsequent tools work automatically.",
      inputSchema: {
        walletAddress: z.string().describe("Your Ethereum wallet address"),
        signature: z.string().describe("Hex signature of the challenge message"),
        timestamp: z.number().describe("Timestamp returned by auth_get_challenge"),
      },
    },
    async ({ walletAddress, signature, timestamp }, extra) => {
      const sessionId = (extra?.sessionId as string | undefined) ?? walletAddress;

      const data = await shard.post<{ success: boolean; token: string; walletAddress: string }>(
        "/auth/verify",
        { walletAddress, signature, timestamp }
      );

      setSession(sessionId, walletAddress, data.token);

      return {
        content: [
          {
            type: "text" as const,
            text: `Authenticated as ${walletAddress}. Session active for 24h.`,
          },
        ],
      };
    }
  );

  /**
   * Register a new wallet (get sFUEL + 50 welcome gold).
   */
  server.registerTool(
    "wallet_register",
    {
      description:
        "Register a new wallet with WoG for the first time. Grants sFUEL (gas) and 50 welcome GOLD tokens. Must be called before spawning a character.",
      inputSchema: {
        walletAddress: z.string().describe("Ethereum wallet address to register"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.post<unknown>("/wallet/register", { walletAddress });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  /**
   * Get wallet gold + item balances.
   */
  server.registerTool(
    "wallet_get_balance",
    {
      description:
        "Get the gold and item (NFT) balances for a wallet address from the blockchain.",
      inputSchema: {
        walletAddress: z.string().describe("Ethereum wallet address"),
      },
    },
    async ({ walletAddress }) => {
      const data = await shard.get<unknown>(`/wallet/${walletAddress}/balance`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  /**
   * Log out and clear session.
   */
  server.registerTool(
    "auth_logout",
    {
      description: "Clear the current authentication session.",
      inputSchema: {
        sessionId: z.string().describe("Session ID to clear (usually your wallet address)"),
      },
    },
    async ({ sessionId }) => {
      deleteSession(sessionId);
      return {
        content: [{ type: "text" as const, text: "Session cleared." }],
      };
    }
  );
}
