/**
 * OpenRouter API Client
 *
 * Singleton client for calling LLMs via OpenRouter.
 * Follows the same pattern as the Circle client.
 */

import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import type {
  OpenRouterRequest,
  OpenRouterResponse,
  OpenRouterError,
} from "./types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_REQUEST_GAP_MS = 5_000;

let lastRequestTime = 0;

/**
 * Check if OpenRouter integration is configured
 */
export function isOpenRouterConfigured(): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

/**
 * Get the configured model name
 */
export function getModelName(): string {
  return env.OPENROUTER_MODEL;
}

/**
 * Call OpenRouter chat completion API
 *
 * @param systemPrompt - System message defining agent personality
 * @param userPrompt - User message with state and instructions
 * @param model - Optional model override
 * @returns The LLM response content string
 */
export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  if (!isOpenRouterConfigured()) {
    throw new Error("OpenRouter API key not configured");
  }

  // Rate limiting: enforce minimum gap between requests
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_GAP_MS) {
    const waitMs = MIN_REQUEST_GAP_MS - timeSinceLast;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const requestBody: OpenRouterRequest = {
    model: model || env.OPENROUTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  };

  logger.info(
    { model: requestBody.model, promptLength: userPrompt.length },
    "Calling OpenRouter API"
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    lastRequestTime = Date.now();

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://versus.app",
        "X-Title": "Versus Agent",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as OpenRouterError | null;
      const errorMessage =
        errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(`OpenRouter API error: ${errorMessage}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("OpenRouter returned empty choices");
    }

    const content = data.choices[0].message.content;

    logger.info(
      {
        model: data.model,
        tokens: data.usage?.total_tokens,
        responseLength: content.length,
      },
      "OpenRouter response received"
    );

    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
