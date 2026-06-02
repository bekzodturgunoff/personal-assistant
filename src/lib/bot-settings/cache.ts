import type {BotSettings} from "./types.js";
import {getDefaultSettings, generateCommandId} from "./defaults.js";
import {getLongTermKv} from "../../memory/index.js";
import {appendPersonaHistory} from "./persona.js";

const SETTINGS_KEY = "_settings";

let cache: {settings: BotSettings; identityPrompt: string; ts: number} | null = null;
const CACHE_TTL = 30_000;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  if (!source) return target;
  const result = {...target};
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined && source[key] !== null) {
      if (
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

export async function getBotSettings(): Promise<BotSettings> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return cache.settings;
  }
  const kv = getLongTermKv();
  if (!kv) return getDefaultSettings();
  try {
    const raw = await kv.get(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<BotSettings>) : {};
    const defaults = getDefaultSettings();
    const merged = deepMerge(defaults as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>) as unknown as BotSettings;
    if (merged.commands.length > 0 && typeof merged.commands[0] === "object" && "command" in (merged.commands[0] as unknown as Record<string, unknown>) && !("id" in (merged.commands[0] as unknown as Record<string, unknown>))) {
      merged.commands = (merged.commands as unknown as Array<{command: string; description: string}>).map((c) => ({
        id: generateCommandId(), name: c.command, description: c.description, instruction: "", generatedPrompt: "", enabled: true, createdAt: Date.now(), lastTestedAt: null, lastTestOutput: null,
      }));
    }
    cache = {settings: merged, identityPrompt: "", ts: Date.now()};
    return merged;
  } catch {
    const d = getDefaultSettings();
    cache = {settings: d, identityPrompt: "", ts: Date.now()};
    return d;
  }
}

export async function saveBotSettings(settings: BotSettings): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(SETTINGS_KEY, JSON.stringify(settings));
  cache = null;
  appendPersonaHistory(settings).catch(() => {});
}

export async function getCachedSettings(): Promise<BotSettings> {
  return getBotSettings();
}
