import type {GeminiResponse} from "./gemini.js";
import {getCachedSettings} from "./bot-settings/index.js";

export interface ConfidenceCheck {
  score: number;
  isFactualClaim: boolean;
  shouldFallback: boolean;
  fallbackPhrase: string;
  clarifier: string;
}

export async function evaluateConfidence(geminiResponse: GeminiResponse): Promise<ConfidenceCheck> {
  const settings = await getCachedSettings();
  const c = settings.confidence;

  const score = typeof geminiResponse.confidence === "number"
    ? Math.max(0, Math.min(1, geminiResponse.confidence))
    : 1.0;

  const isFactualClaim = geminiResponse.isFactualClaim === true;

  const shouldFallback = c.enabled && score < c.fallbackThreshold && isFactualClaim;

  const fallbackPhrase = shouldFallback
    ? c.fallbackPhrases[Math.floor(Math.random() * c.fallbackPhrases.length)]
    : "";

  return {
    score,
    isFactualClaim,
    shouldFallback,
    fallbackPhrase,
    clarifier: "",
  };
}
