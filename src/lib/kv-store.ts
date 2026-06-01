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
  chatMessages: Record<string, number>;
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
    chatMessages: {},
  };
}

export async function getWeeklyAccumulator(): Promise<WeeklyAccumulator> {
  return longTermOp(
    (kv) => kv.get(ACCUMULATOR_KEY).then((r) => {
      if (!r) return getDefaultAccumulator();
      const parsed = JSON.parse(r);
      const fresh = getDefaultAccumulator();
      if (parsed.weekStart !== fresh.weekStart) return fresh;
      return { ...parsed };
    }),
    getDefaultAccumulator(),
  );
}

export async function saveWeeklyAccumulator(acc: WeeklyAccumulator): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(ACCUMULATOR_KEY, JSON.stringify(acc));
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
