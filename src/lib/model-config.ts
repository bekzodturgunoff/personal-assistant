import {getConversationsKv} from "../memory/index.js";
import {getEnv} from "../config/env.js";
import {KV_KEYS, MODEL_NAMES, ENV_NAMES} from "../config/constants.js";

const GEMINI_CONFIG_KEY = KV_KEYS.GEMINI_CONFIG;
const GROQ_CONFIG_KEY = KV_KEYS.GROQ_CONFIG;

function envDefaultGeminiModels(): string[] {
  const m0 = getEnv(ENV_NAMES.AI_MODEL);
  const m1 = getEnv(ENV_NAMES.AI_FALLBACK_MODEL);
  const m2 = getEnv(ENV_NAMES.AI_FALLBACK_MODEL_2);
  const m3 = getEnv(ENV_NAMES.AI_FALLBACK_MODEL_3);
  const m4 = getEnv(ENV_NAMES.AI_FALLBACK_MODEL_4);
  if (m0) return [m0, m1 || MODEL_NAMES.GEMINI_DEFAULT[1], m2 || MODEL_NAMES.GEMINI_DEFAULT[2], m3 || MODEL_NAMES.GEMINI_DEFAULT[3], m4 || MODEL_NAMES.GEMINI_DEFAULT[4]].filter(Boolean);
  return [];
}

const DEFAULT_GEMINI_MODELS = (() => {
  const env = envDefaultGeminiModels();
  if (env.length > 0) return env;
  return [...MODEL_NAMES.GEMINI_DEFAULT];
})();

const DEFAULT_GROQ_CHAT_MODELS = [...MODEL_NAMES.GROQ_CHAT_DEFAULT];
const DEFAULT_GROQ_JSON_MODELS = [...MODEL_NAMES.GROQ_JSON_DEFAULT];

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
