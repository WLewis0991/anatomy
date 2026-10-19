import "server-only";

import { ensureTracingEnv, openRouterApiKey } from "./config";
import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";

/**
 * The only place an AI client is constructed. Every call made through this
 * client is wrapped by LangSmith; a second `new OpenAI(...)` anywhere else would
 * trace nothing and would be invisible in the dashboard.
 *
 * OpenRouter speaks the OpenAI API, so the SDK is unchanged and only the base
 * URL and key differ.
 */
let client: OpenAI | null = null;

export function getAiClient(): OpenAI {
  ensureTracingEnv();

  const apiKey = openRouterApiKey();
  if (apiKey === null) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local to use explanations and role labels.",
    );
  }

  if (client === null) {
    const base = new OpenAI({
      apiKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "X-Title": "Anatomy",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
      },
    });
    client = wrapOpenAI(base);
  }

  return client;
}
