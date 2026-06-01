import {getConversationsKv} from "./kv-store.js";
import {getEnv} from "../runtime-env.js";

const GEMINI_CONFIG_KEY = "config:models:gemini";
const GROQ_CONFIG_KEY = "config:models:groq";

function envDefaultGeminiModels(): string[] {
  const m0 = getEnv("AI_MODEL");
  const m1 = getEnv("AI_FALLBACK_MODEL");
  const m2 = getEnv("AI_FALLBACK_MODEL_2");
  const m3 = getEnv("AI_FALLBACK_MODEL_3");
  const m4 = getEnv("AI_FALLBACK_MODEL_4");
  if (m0) return [m0, m1 || "gemini-2.5-flash", m2 || "gemini-3.1-flash-lite", m3 || "gemini-3.5-flash", m4 || "gemini-2.5-pro"].filter(Boolean);
  return [];
}

const DEFAULT_GEMINI_MODELS = (() => {
  const env = envDefaultGeminiModels();
  if (env.length > 0) return env;
  return [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-pro",
  ];
})();

const DEFAULT_GROQ_CHAT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const DEFAULT_GROQ_JSON_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

export interface GeminiModelConfig {
  models: string[];
}

export interface GroqModelConfig {
  chatModels: string[];
  jsonModels: string[];
}

async function getKv() {
  return getConversationsKv();
}

export async function getGeminiModels(): Promise<string[]> {
  const kv = await getKv();
  if (!kv) return DEFAULT_GEMINI_MODELS;
  try {
    const raw = await kv.get(GEMINI_CONFIG_KEY);
    if (!raw) return DEFAULT_GEMINI_MODELS;
    const config = JSON.parse(raw) as GeminiModelConfig;
    if (Array.isArray(config.models) && config.models.length > 0) return config.models;
    return DEFAULT_GEMINI_MODELS;
  } catch {
    return DEFAULT_GEMINI_MODELS;
  }
}

export async function setGeminiModels(models: string[]): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  await kv.put(GEMINI_CONFIG_KEY, JSON.stringify({models}));
}

export async function getGroqModels(): Promise<GroqModelConfig> {
  const kv = await getKv();
  if (!kv) return {chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS};
  try {
    const raw = await kv.get(GROQ_CONFIG_KEY);
    if (!raw) return {chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS};
    const config = JSON.parse(raw) as GroqModelConfig;
    return {
      chatModels: Array.isArray(config.chatModels) && config.chatModels.length > 0 ? config.chatModels : DEFAULT_GROQ_CHAT_MODELS,
      jsonModels: Array.isArray(config.jsonModels) && config.jsonModels.length > 0 ? config.jsonModels : DEFAULT_GROQ_JSON_MODELS,
    };
  } catch {
    return {chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS};
  }
}

export async function setGroqModels(config: GroqModelConfig): Promise<void> {
  const kv = await getKv();
  if (!kv) return;
  await kv.put(GROQ_CONFIG_KEY, JSON.stringify(config));
}

export {DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_CHAT_MODELS, DEFAULT_GROQ_JSON_MODELS};
