import {getLongTermKv} from "./store.js";

export interface WeeklyAccumulator {
  weekStart: string;
  totalMessages: number;
  conversationsSeen: string[];
  lowConfTotal: number;
  unresolvedCount: number;
  brainRunCount: number;
  brainErrorCount: number;
  groqParseFailures: number;
  chatMessages: Record<string, number>;
  languageBreakdown: { uz: number; ru: number; en: number; mixed: number };
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  intentBreakdown: { price_inquiry: number; complaint: number; greeting: number; request: number; follow_up: number; other: number };
  daily: Array<{ date: string; messages: number; brainRuns: number }>;
  lastDailyCronAt: string | null;
  lastWeeklyCronAt: string | null;
}

const ACCUMULATOR_KEY = "analytics:current";

function getCurrentMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

export function getDefaultAccumulator(): WeeklyAccumulator {
  return {
    weekStart: getCurrentMonday(),
    totalMessages: 0,
    conversationsSeen: [],
    lowConfTotal: 0,
    unresolvedCount: 0,
    brainRunCount: 0,
    brainErrorCount: 0,
    groqParseFailures: 0,
    chatMessages: {},
    languageBreakdown: { uz: 0, ru: 0, en: 0, mixed: 0 },
    sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
    intentBreakdown: { price_inquiry: 0, complaint: 0, greeting: 0, request: 0, follow_up: 0, other: 0 },
    daily: [],
    lastDailyCronAt: null,
    lastWeeklyCronAt: null,
  };
}

export async function getWeeklyAccumulator(): Promise<WeeklyAccumulator> {
  return (async (): Promise<WeeklyAccumulator> => {
    const kv = getLongTermKv();
    if (!kv) return getDefaultAccumulator();
    try {
      const r = await kv.get(ACCUMULATOR_KEY);
      if (!r) return getDefaultAccumulator();
      const parsed = JSON.parse(r);
      const fresh = getDefaultAccumulator();
      if (parsed.weekStart !== fresh.weekStart) return fresh;
      return {
        ...fresh,
        ...parsed,
        conversationsSeen: Array.isArray(parsed.conversationsSeen) ? parsed.conversationsSeen : fresh.conversationsSeen,
        languageBreakdown: {...fresh.languageBreakdown, ...(parsed.languageBreakdown || {})},
        sentimentBreakdown: {...fresh.sentimentBreakdown, ...(parsed.sentimentBreakdown || {})},
        intentBreakdown: {...fresh.intentBreakdown, ...(parsed.intentBreakdown || {})},
        daily: Array.isArray(parsed.daily) ? parsed.daily : fresh.daily,
      };
    } catch {
      return getDefaultAccumulator();
    }
  })();
}

export async function saveWeeklyAccumulator(acc: WeeklyAccumulator): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(ACCUMULATOR_KEY, JSON.stringify(acc));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function touchDailyEntry(acc: WeeklyAccumulator, messages = 0, brainRuns = 0): void {
  const today = todayStr();
  let entry = acc.daily.find((d) => d.date === today);
  if (!entry) {
    entry = { date: today, messages: 0, brainRuns: 0 };
    acc.daily.push(entry);
    if (acc.daily.length > 14) acc.daily = acc.daily.slice(-14);
  }
  entry.messages += messages;
  entry.brainRuns += brainRuns;
}

export async function resetWeeklyAccumulator(): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(ACCUMULATOR_KEY, JSON.stringify(getDefaultAccumulator()));
}
