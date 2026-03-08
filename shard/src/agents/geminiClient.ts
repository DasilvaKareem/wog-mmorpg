/**
 * Shared Gemini client — used by agentSupervisor and agentChatRoutes.
 * Uses @google/genai SDK with Vertex AI or Google AI Studio.
 */

import { GoogleGenAI } from "@google/genai";

const useVertexAI = Boolean(process.env.GOOGLE_CLOUD_PROJECT);

export const gemini = new GoogleGenAI(
  useVertexAI
    ? {
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT!,
        location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
      }
    : { apiKey: process.env.GEMINI_API_KEY ?? "" },
);

export const GEMINI_MODEL =
  process.env.AGENT_SUPERVISOR_MODEL ?? "gemini-3.1-flash-lite-preview";
