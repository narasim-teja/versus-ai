/**
 * OpenRouter API Types
 *
 * Type definitions for OpenRouter chat completion requests and responses.
 */

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface OpenRouterChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
  index: number;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  usage: OpenRouterUsage;
  model: string;
}

export interface OpenRouterError {
  error: {
    message: string;
    type: string;
    code: number;
  };
}
