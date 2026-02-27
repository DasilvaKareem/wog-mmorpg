/**
 * Name Service API Routes
 * .wog domain registration, resolution, and availability endpoints
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import {
  registerNameOnChain,
  releaseNameOnChain,
  resolveNameOnChain,
  reverseLookupOnChain,
  isNameAvailable,
} from "./nameServiceChain.js";

/** Validate name: 3-16 chars, a-zA-Z0-9_- only */
function validateName(name: string): string | null {
  if (!name || typeof name !== "string") return "Name is required";
  if (name.length < 3) return "Name must be at least 3 characters";
  if (name.length > 16) return "Name must be at most 16 characters";
  if (!/^[a-zA-Z0-9_-]+$/.test(name))
    return "Name can only contain letters, numbers, underscores, and hyphens";
  return null;
}

export function registerNameServiceRoutes(server: FastifyInstance) {
  /**
   * POST /name/register
   * Register a .wog name for a wallet
   */
  server.post<{
    Body: { walletAddress: string; name: string };
  }>(
    "/name/register",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, name } = request.body;

      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      const nameError = validateName(name);
      if (nameError) {
        reply.code(400);
        return { error: nameError };
      }

      // Check availability
      const available = await isNameAvailable(name);
      if (!available) {
        reply.code(409);
        return { error: "Name is already taken" };
      }

      // Check if wallet already has a name
      const existing = await reverseLookupOnChain(walletAddress);
      if (existing) {
        reply.code(409);
        return { error: `Wallet already has name "${existing}.wog"` };
      }

      const success = await registerNameOnChain(walletAddress, name);
      return {
        ok: true,
        name: `${name}.wog`,
        walletAddress,
        onChain: success,
      };
    }
  );

  /**
   * POST /name/release
   * Release a wallet's current .wog name
   */
  server.post<{
    Body: { walletAddress: string };
  }>(
    "/name/release",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress } = request.body;

      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      const existing = await reverseLookupOnChain(walletAddress);
      if (!existing) {
        reply.code(404);
        return { error: "Wallet does not have a .wog name" };
      }

      const success = await releaseNameOnChain(walletAddress);
      return {
        ok: true,
        released: `${existing}.wog`,
        onChain: success,
      };
    }
  );

  /**
   * GET /name/resolve/:name
   * Resolve a .wog name to its owner address
   */
  server.get<{
    Params: { name: string };
  }>("/name/resolve/:name", async (request, reply) => {
    const { name } = request.params;

    // Strip .wog suffix if provided
    const cleanName = name.replace(/\.wog$/i, "");

    const address = await resolveNameOnChain(cleanName);
    if (!address) {
      reply.code(404);
      return { error: "Name not found" };
    }

    return { name: `${cleanName}.wog`, address };
  });

  /**
   * GET /name/lookup/:address
   * Reverse lookup — get the .wog name for a wallet address
   */
  server.get<{
    Params: { address: string };
  }>("/name/lookup/:address", async (request, reply) => {
    const { address } = request.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    const name = await reverseLookupOnChain(address);
    if (!name) {
      reply.code(404);
      return { error: "No .wog name for this address" };
    }

    return { address, name: `${name}.wog` };
  });

  /**
   * GET /name/check/:name
   * Check if a .wog name is available
   */
  server.get<{
    Params: { name: string };
  }>("/name/check/:name", async (request) => {
    const { name } = request.params;

    const cleanName = name.replace(/\.wog$/i, "");

    const validationError = validateName(cleanName);
    if (validationError) {
      return { name: cleanName, available: false, reason: validationError };
    }

    const available = await isNameAvailable(cleanName);
    return { name: `${cleanName}.wog`, available };
  });
}
