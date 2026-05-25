import {GoogleGenAI} from "@google/genai/web";
import {config} from "../config.js";
import {getEnv} from "../runtime-env.js";
import {pickJoke, detectTopic} from "./jokes.js";

let aiClient: GoogleGenAI | undefined;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = config.aiApiKey;
    if (!apiKey) {
      throw new Error("AI_API_KEY is not configured — AI features unavailable");
    }
    aiClient = new GoogleGenAI({apiKey});
  }
  return aiClient;
}

export function isVeryShortQuestion(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 || text.length < 20;
}

export function isCreatorQuestion(text: string): boolean {
  return /creator|who made you|who created you|kim yaratdi|seni kim/i.test(
    text.toLowerCase(),
  );
}

const PERSONALITIES = [
  "sleep deprived engineer",
  "chaotic dev",
  "burned out CTO",
  "meme lord dev",
  "DevOps with trauma",
];

export function randomPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

export function limitResponse(
  text: string,
  maxChars: number,
  maxSentences: number,
): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const limited = sentences.slice(0, maxSentences).join(" ");
  return limited.length > maxChars
    ? limited.slice(0, maxChars).trim() + "…"
    : limited;
}

const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
let primaryRetryAt = 0;

function isQuotaOrRateLimitError(error: unknown): boolean {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status =
    typeof candidate?.status === "number" ? candidate.status : undefined;
  const code =
    typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = String(candidate?.message ?? "").toLowerCase();

  return (
    status === 429 ||
    status === 403 ||
    code.includes("resource_exhausted") ||
    code.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("limit exceeded")
  );
}

async function callGemini(
  prompt: string,
  model: string,
): Promise<string | null> {
  try {
    const ai = getAiClient();
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    const text = res.text ?? "";
    if (text) return text;
  } catch (e) {
    console.error(`AI error (${model}):`, e);
    if (isQuotaOrRateLimitError(e)) {
      return "QUOTA_ERROR";
    }
  }
  return null;
}

const PRIMARY_MODEL = getEnv("AI_MODEL") || "gemini-2.5-flash";
const FALLBACK_MODEL = getEnv("AI_FALLBACK_MODEL") || "gemini-2.5-flash-lite";

async function callGeminiWithFallback(prompt: string): Promise<string | null> {
  const now = Date.now();
  if (now >= primaryRetryAt) {
    const result = await callGemini(prompt, PRIMARY_MODEL);
    if (result === "QUOTA_ERROR") {
      primaryRetryAt = now + PRIMARY_COOLDOWN_MS;
      const fallback = await callGemini(prompt, FALLBACK_MODEL);
      if (fallback && fallback !== "QUOTA_ERROR") return fallback;
    } else if (result) {
      primaryRetryAt = 0;
      return result;
    }
  }

  const fallback = await callGemini(prompt, FALLBACK_MODEL);
  if (fallback && fallback !== "QUOTA_ERROR") return fallback;
  return null;
}

export async function generateWithFallback(
  kind: string,
  userText: string,
  prompt: string,
) {
  const result = await callGeminiWithFallback(prompt);
  if (result) return result;

  const joke = pickJoke(detectTopic(userText), `${kind}:${userText}`);
  return kind === "roast" ? `🔥 ${joke}` : joke;
}
