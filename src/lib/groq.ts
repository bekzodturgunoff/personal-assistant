import {config} from "../config/env.js";
import {getGroqModels} from "./model-config.js";
import {recordGroqUsage} from "./usage-stats.js";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

let requestCounter = 0;

function isQuotaError(status: number, body: string): boolean {
  return (
    status === 429 ||
    status === 503 ||
    body.toLowerCase().includes("rate limit") ||
    body.toLowerCase().includes("quota") ||
    body.toLowerCase().includes("too many requests")
  );
}

async function callGroqModel(
  messages: GroqMessage[],
  model: string,
  reqId: number,
  jsonMode: boolean,
): Promise<string | null> {
  const preview = messages[messages.length - 1]?.content.slice(0, 100) || "";
  console.log(`[Groq:${reqId}] >>> calling ${model} — "${preview}..."`);

  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: jsonMode ? 0.3 : 0.8,
        max_tokens: jsonMode ? 1024 : 512,
        ...(jsonMode ? {response_format: {type: "json_object"}} : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[Groq:${reqId}] ERROR (${model}): ${res.status} ${errBody.slice(0, 200)}`);
      if (isQuotaError(res.status, errBody)) return "QUOTA_ERROR";
      return null;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = data.choices?.[0]?.message?.content || "";

    if (data.usage) {
      recordGroqUsage(model, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
    }

    if (text) {
      console.log(`[Groq:${reqId}] <<< ${model} ok (${text.length} chars)`);
      return text;
    }

    console.log(`[Groq:${reqId}] <<< ${model} empty response`);
    return null;
  } catch (e) {
    console.error(`[Groq:${reqId}] FETCH ERROR (${model}):`, e);
    return null;
  }
}

export async function callGroqWithFallback(
  messages: GroqMessage[],
  jsonMode = false,
): Promise<string> {
  const reqId = ++requestCounter;
  const groqConfig = await getGroqModels();
  const models = jsonMode ? groqConfig.jsonModels : groqConfig.chatModels;

  console.log(`[Groq:${reqId}] starting — models: ${models.join(", ")}`);

  for (const model of models) {
    const result = await callGroqModel(messages, model, reqId, jsonMode);

    if (result === "QUOTA_ERROR") {
      console.log(`[Groq:${reqId}] ${model} quota hit, trying next`);
      continue;
    }

    if (result) {
      console.log(`[Groq:${reqId}] ${model} succeeded`);
      return result;
    }

    console.log(`[Groq:${reqId}] ${model} failed (non-quota), trying next`);
  }

  throw new Error(`All Groq models exhausted (reqId=${reqId})`);
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
