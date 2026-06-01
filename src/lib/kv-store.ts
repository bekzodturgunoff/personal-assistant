export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
  list?<Meta = unknown>(prefix?: {prefix: string}): Promise<{keys: {name: string; metadata?: Meta}[]}>;
}

let conversationsKv: KvStore | null = null;
let tasksKv: KvStore | null = null;
let longTermKv: KvStore | null = null;
let modelCooldownKv: KvStore | null = null;

export function setConversationsKv(kv: KvStore): void { conversationsKv = kv; }
export function setTasksKv(kv: KvStore): void { tasksKv = kv; }
export function setLongTermKv(kv: KvStore): void { longTermKv = kv; }
export function setModelCooldownKv(kv: KvStore): void { modelCooldownKv = kv; }

export function getConversationsKv(): KvStore | null { return conversationsKv; }
export function getTasksKv(): KvStore | null { return tasksKv; }
export function getLongTermKv(): KvStore | null { return longTermKv; }
export function getModelCooldownKv(): KvStore | null { return modelCooldownKv; }

// ── Unified UserMeta — single KV key per user in LONG_TERM_MEMORY ──

export interface UserMeta {
  pendingQuestions: string[];
  lowConfCount: number;
  relationshipStage: "stranger" | "acquaintance" | "warm_lead" | "regular";
  firstContactDate: string | null;
  lastIntent: string;
  lastSentiment: string;
  lastUrgency: "low" | "medium" | "high";
  messageCount: number;
  businessConnectionId: string;
  forcedTone: "" | "formal" | "casual" | "warm";
  forcedLanguage: "" | "uz" | "ru" | "en";
  lastMessageTimestamp: number;
}

const META_KEY = (chatId: string) => `meta:${chatId}`;

export const META_DEFAULTS: UserMeta = {
  pendingQuestions: [],
  lowConfCount: 0,
  relationshipStage: "stranger",
  firstContactDate: null,
  lastIntent: "other",
  lastSentiment: "neutral",
  lastUrgency: "low",
  messageCount: 0,
  businessConnectionId: "",
  forcedTone: "",
  forcedLanguage: "",
  lastMessageTimestamp: 0,
};

async function longTermOp<T>(fn: (kv: KvStore) => Promise<T>, fallback: T): Promise<T> {
  const kv = getLongTermKv();
  if (!kv) return fallback;
  try {
    return await fn(kv);
  } catch {
    return fallback;
  }
}

// ── Core UserMeta functions (1 read + 1 write per update) ──

export async function getUserMeta(chatId: string): Promise<UserMeta> {
  return longTermOp(
    (kv) => kv.get(META_KEY(chatId)).then((r) => {
      if (!r) return { ...META_DEFAULTS };
      return { ...META_DEFAULTS, ...JSON.parse(r) };
    }),
    { ...META_DEFAULTS },
  );
}

export async function setUserMeta(chatId: string, meta: UserMeta): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(META_KEY(chatId), JSON.stringify(meta));
}

export async function updateUserMeta(chatId: string, patch: Partial<UserMeta>): Promise<UserMeta> {
  const current = await getUserMeta(chatId);
  const updated = { ...current, ...patch };
  await setUserMeta(chatId, updated);
  return updated;
}

// ── Legacy metadata helpers (wrappers around UserMeta) ──

export async function getPendingQuestions(chatId: string): Promise<string[]> {
  const meta = await getUserMeta(chatId);
  return meta.pendingQuestions;
}

export async function getLowConfCount(chatId: string): Promise<number> {
  const meta = await getUserMeta(chatId);
  return meta.lowConfCount;
}

export async function incrementLowConfCount(chatId: string): Promise<number> {
  const meta = await updateUserMeta(chatId, { lowConfCount: (await getUserMeta(chatId)).lowConfCount + 1 });
  return meta.lowConfCount;
}

export async function resetLowConfCount(chatId: string): Promise<void> {
  await updateUserMeta(chatId, { lowConfCount: 0 });
}

export async function getRelationshipStage(chatId: string): Promise<string> {
  const meta = await getUserMeta(chatId);
  return meta.relationshipStage;
}

export async function setRelationshipStage(chatId: string, stage: UserMeta["relationshipStage"]): Promise<void> {
  await updateUserMeta(chatId, { relationshipStage: stage });
}

export async function getFirstContactDate(chatId: string): Promise<Date | null> {
  const meta = await getUserMeta(chatId);
  return meta.firstContactDate ? new Date(meta.firstContactDate) : null;
}

export async function setFirstContactDate(chatId: string, date: Date): Promise<void> {
  await updateUserMeta(chatId, { firstContactDate: date.toISOString() });
}

// ── Analytics accumulator (single key, no list() scans) ──

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
  return longTermOp(
    (kv) => kv.get(ACCUMULATOR_KEY).then((r) => {
      if (!r) return getDefaultAccumulator();
      const parsed = JSON.parse(r);
      const fresh = getDefaultAccumulator();
      if (parsed.weekStart !== fresh.weekStart) return fresh;
      return {
        ...fresh,
        ...parsed,
        conversationsSeen: Array.isArray(parsed.conversationsSeen) ? parsed.conversationsSeen : fresh.conversationsSeen,
        languageBreakdown: { ...fresh.languageBreakdown, ...(parsed.languageBreakdown || {}) },
        sentimentBreakdown: { ...fresh.sentimentBreakdown, ...(parsed.sentimentBreakdown || {}) },
        intentBreakdown: { ...fresh.intentBreakdown, ...(parsed.intentBreakdown || {}) },
        daily: Array.isArray(parsed.daily) ? parsed.daily : fresh.daily,
      };
    }),
    getDefaultAccumulator(),
  );
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

// ── Pause helpers (stored in LONG_TERM_MEMORY as paused:{chatId} → ISO string) ──

export async function setPausedUntil(chatId: string, untilISO: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(`paused:${chatId}`, untilISO);
}

export async function getPausedUntil(chatId: number): Promise<string | null> {
  return longTermOp(
    (kv) => kv.get(`paused:${chatId}`),
    null,
  );
}

export async function clearPausedUntil(chatId: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.delete?.(`paused:${chatId}`);
}

// ── KV delete helpers (for /forget command) ──

export async function deleteLongTermKey(key: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.delete?.(key);
}

export async function deleteConversationsKey(key: string): Promise<void> {
  const kv = getConversationsKv();
  if (!kv) return;
  await kv.delete?.(key);
}
