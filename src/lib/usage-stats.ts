import {getLongTermKv} from "./kv-store.js";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageStats {
  month: string;
  gemini: Record<string, ModelUsage>;
  groq: Record<string, ModelUsage>;
}

const USAGE_KEY = "usage:stats";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getDefaultUsageStats(): UsageStats {
  return {month: currentMonth(), gemini: {}, groq: {}};
}

export async function getUsageStats(): Promise<UsageStats> {
  const kv = getLongTermKv();
  if (!kv) return getDefaultUsageStats();
  try {
    const raw = await kv.get(USAGE_KEY);
    if (!raw) return getDefaultUsageStats();
    const parsed = JSON.parse(raw) as UsageStats;
    if (parsed.month !== currentMonth()) return getDefaultUsageStats();
    return {
      month: parsed.month,
      gemini: parsed.gemini || {},
      groq: parsed.groq || {},
    };
  } catch {
    return getDefaultUsageStats();
  }
}

export async function recordGeminiUsage(model: string, inputTokens: number, outputTokens: number): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  try {
    const stats = await getUsageStats();
    if (!stats.gemini[model]) {
      stats.gemini[model] = {inputTokens: 0, outputTokens: 0, calls: 0};
    }
    stats.gemini[model].inputTokens += inputTokens;
    stats.gemini[model].outputTokens += outputTokens;
    stats.gemini[model].calls++;
    await kv.put(USAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("[UsageStats] recordGeminiUsage error:", e);
  }
}

export async function recordGroqUsage(model: string, inputTokens: number, outputTokens: number): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  try {
    const stats = await getUsageStats();
    if (!stats.groq[model]) {
      stats.groq[model] = {inputTokens: 0, outputTokens: 0, calls: 0};
    }
    stats.groq[model].inputTokens += inputTokens;
    stats.groq[model].outputTokens += outputTokens;
    stats.groq[model].calls++;
    await kv.put(USAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("[UsageStats] recordGroqUsage error:", e);
  }
}

export async function resetUsageStats(): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(USAGE_KEY, JSON.stringify(getDefaultUsageStats()));
}
