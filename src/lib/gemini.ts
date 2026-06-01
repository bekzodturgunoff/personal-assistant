import {GoogleGenAI} from "@google/genai/web";
import {config} from "../config.js";
import {getEnv} from "../runtime-env.js";
import {getModelCooldownKv} from "./kv-store.js";

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

let requestCounter = 0;

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

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const MODEL_NAMES = [
  getEnv("AI_MODEL") || "gemini-2.5-flash-lite",
  getEnv("AI_FALLBACK_MODEL") || "gemini-2.5-flash",
  getEnv("AI_FALLBACK_MODEL_2") || "gemini-3.1-flash-lite",
  getEnv("AI_FALLBACK_MODEL_3") || "gemini-3.5-flash",
  getEnv("AI_FALLBACK_MODEL_4") || "gemini-2.5-pro",
];

function kvKey(model: string): string {
  return `cooldown:${model}`;
}

async function getCooldown(model: string): Promise<number> {
  const kv = getModelCooldownKv();
  if (!kv) return 0;
  try {
    const raw = await kv.get(kvKey(model));
    return raw ? Number(raw) || 0 : 0;
  } catch (e) {
    console.error(`[Gemini] KV read error for ${kvKey(model)}:`, e);
    return 0;
  }
}

async function setCooldown(model: string, until: number): Promise<void> {
  const kv = getModelCooldownKv();
  if (!kv) return;
  try {
    if (until > 0) {
      await kv.put(kvKey(model), String(until));
    } else {
      await kv.put(kvKey(model), "0");
    }
  } catch (e) {
    console.error(`[Gemini] KV write error for ${kvKey(model)}:`, e);
  }
}

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

  if (status !== undefined) {
    console.log(`[Gemini] error status=${status} code="${code}" message="${message.slice(0, 120)}"`);
  }

  if (status === 403) {
    return false;
  }

  return (
    status === 429 ||
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
  reqId: number,
): Promise<string | null> {
  const preview = prompt.slice(0, 200).replace(/\n/g, "\\n");
  console.log(`[Gemini:${reqId}] >>> calling ${model} — prompt preview: "${preview}..."`);

  try {
    const ai = getAiClient();
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    const text = res.text ?? "";
    const responsePreview = text.slice(0, 100).replace(/\n/g, "\\n");
    console.log(`[Gemini:${reqId}] <<< ${model} response: "${responsePreview}..." (${text.length} chars)`);
    if (text) return text;
    console.log(`[Gemini:${reqId}] <<< ${model} returned empty response`);
  } catch (e) {
    console.error(`[Gemini:${reqId}] ERROR (${model}):`, e);
    if (isQuotaOrRateLimitError(e)) {
      return "QUOTA_ERROR";
    }
  }
  return null;
}

export async function callGeminiWithFallback(prompt: string): Promise<string> {
  const reqId = ++requestCounter;
  const now = Date.now();

  const statuses = await Promise.all(MODEL_NAMES.map(async (name) => {
    const cd = await getCooldown(name);
    return `${name}[${cd > now ? (cd - now) / 1000 + "s" : "ready"}]`;
  }));
  console.log(`[Gemini:${reqId}] starting — ${statuses.join(" | ")}`);

  for (let i = 0; i < MODEL_NAMES.length; i++) {
    const name = MODEL_NAMES[i];
    const cd = await getCooldown(name);

    if (now < cd) {
      console.log(`[Gemini:${reqId}] model ${i} (${name}) on cooldown — ${(cd - now) / 1000}s remaining, skipping`);
      continue;
    }

    const result = await callGemini(prompt, name, reqId);

    if (result === "QUOTA_ERROR") {
      const until = now + COOLDOWN_MS;
      await setCooldown(name, until);
      console.log(`[Gemini:${reqId}] model ${i} (${name}) quota exhausted — cooldown until ${new Date(until).toISOString()}, trying next`);
      continue;
    }

    if (result) {
      await setCooldown(name, 0);
      console.log(`[Gemini:${reqId}] model ${i} (${name}) succeeded`);
      return result;
    }

    console.log(`[Gemini:${reqId}] model ${i} (${name}) returned null (non-quota), trying next`);
  }

  const final = await Promise.all(MODEL_NAMES.map(async (name, i) => {
    const cd = await getCooldown(name);
    return `${i}:${name}[${cd > now ? "cooldown" : "ready"}]`;
  }));
  console.log(`[Gemini:${reqId}] ALL MODELS EXHAUSTED — ${final.join(", ")}`);
  throw new Error(`Gemini all ${MODEL_NAMES.length} models failed (reqId=${reqId})`);
}

export async function generateWithFallback(
  _kind: string,
  _userText: string,
  prompt: string,
) {
  return callGeminiWithFallback(prompt);
}
