import type {GeminiResponse} from "./gemini.js";

export interface ConfidenceCheck {
  score: number;
  isFactualClaim: boolean;
  shouldFallback: boolean;
  fallbackPhrase: string;
}

const FALLBACKS = [
  "men tekshirib beraman",
  "aniqlab beraman, biroz kuting",
  "hozir bilib olaman",
];

function pickFallback(): string {
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
}

export function evaluateConfidence(geminiResponse: GeminiResponse): ConfidenceCheck {
  const score = typeof geminiResponse.confidence === "number"
    ? Math.max(0, Math.min(1, geminiResponse.confidence))
    : 1.0;

  const isFactualClaim = geminiResponse.isFactualClaim === true;

  const shouldFallback = score < 0.65 && isFactualClaim;

  return {
    score,
    isFactualClaim,
    shouldFallback,
    fallbackPhrase: shouldFallback ? pickFallback() : "",
  };
}
