/**
 * OpenRouter Integration Module
 *
 * Re-exports all OpenRouter functionality.
 */

export {
  chatCompletion,
  isOpenRouterConfigured,
  getModelName,
} from "./client";
export type {
  OpenRouterRequest,
  OpenRouterResponse,
  OpenRouterMessage,
} from "./types";
