import {GoogleGenAI} from "@google/genai/web";
import {config} from "../config.js";
import {getEnv} from "../runtime-env.js";
import {getModelCooldownKv} from "./kv-store.js";
import {getGeminiModels} from "./model-config.js";
import {recordGeminiUsage} from "./usage-stats.js";

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

    const usageMeta = (res as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    if (usageMeta) {
      recordGeminiUsage(model, usageMeta.promptTokenCount || 0, usageMeta.candidatesTokenCount || 0);
    } else {
      recordGeminiUsage(model, prompt.length, text.length);
    }

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

export interface GeminiResponse {
  text: string;
  confidence: number;
  isFactualClaim: boolean;
}

export async function callGeminiWithFallback(prompt: string): Promise<string> {
  const reqId = ++requestCounter;
  const now = Date.now();

  const modelNames = await getGeminiModels();

  const statuses = await Promise.all(modelNames.map(async (name) => {
    const cd = await getCooldown(name);
    return `${name}[${cd > now ? (cd - now) / 1000 + "s" : "ready"}]`;
  }));
  console.log(`[Gemini:${reqId}] starting — ${statuses.join(" | ")}`);

  for (let i = 0; i < modelNames.length; i++) {
    const name = modelNames[i];
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

  const final = await Promise.all(modelNames.map(async (name, i) => {
    const cd = await getCooldown(name);
    return `${i}:${name}[${cd > now ? "cooldown" : "ready"}]`;
  }));
  console.log(`[Gemini:${reqId}] ALL MODELS EXHAUSTED — ${final.join(", ")}`);
  throw new Error(`Gemini all ${modelNames.length} models failed (reqId=${reqId})`);
}

export async function generateWithFallback(
  _kind: string,
  _userText: string,
  prompt: string,
) {
  return callGeminiWithFallback(prompt);
}

export async function callGeminiStructured(
  prompt: string,
): Promise<GeminiResponse> {
  const jsonPrompt = `${prompt}\n\nRespond with a JSON object containing exactly these fields:\n- "text": your main reply text\n- "confidence": a number 0.0 to 1.0 indicating how confident you are in this reply\n- "is_factual_claim": boolean — true if this reply makes a factual claim about the person or world, false if it's just conversation\n\nOnly output valid JSON with no extra text.`;
  try {
    const raw = await callGeminiWithFallback(jsonPrompt);
    const cleaned = raw.replace(/```(json)?/g, "").trim();
    const parsed = JSON.parse(cleaned) as { text?: string; confidence?: number; is_factual_claim?: boolean };
    return {
      text: typeof parsed.text === "string" ? parsed.text : raw,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 1.0,
      isFactualClaim: parsed.is_factual_claim === true,
    };
  } catch (e) {
    console.error("[GeminiStructured] Parse failed, falling back to raw:", e);
    const text = await callGeminiWithFallback(prompt);
    return {text, confidence: 1.0, isFactualClaim: false};
  }
}
