/**
 * xAI Grok client using the OpenAI-compatible API.
 */

import OpenAI from "openai";

export const GROK_MODEL = "grok-4-1-fast-non-reasoning";

let client: OpenAI | null = null;

export function getGrokClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY environment variable is not set");

  client = new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  });

  return client;
}
