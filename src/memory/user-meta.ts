import type {KvStore} from "./store.js";
import {getLongTermKv} from "./store.js";

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

export async function getUserMeta(chatId: string): Promise<UserMeta> {
  return longTermOp(
    (kv) => kv.get(META_KEY(chatId)).then((r) => {
      if (!r) return {...META_DEFAULTS};
      return {...META_DEFAULTS, ...JSON.parse(r)};
    }),
    {...META_DEFAULTS},
  );
}

export async function setUserMeta(chatId: string, meta: UserMeta): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(META_KEY(chatId), JSON.stringify(meta));
}

export async function updateUserMeta(chatId: string, patch: Partial<UserMeta>): Promise<UserMeta> {
  const current = await getUserMeta(chatId);
  const updated = {...current, ...patch};
  await setUserMeta(chatId, updated);
  return updated;
}

export async function getPendingQuestions(chatId: string): Promise<string[]> {
  const meta = await getUserMeta(chatId);
  return meta.pendingQuestions;
}

export async function getLowConfCount(chatId: string): Promise<number> {
  const meta = await getUserMeta(chatId);
  return meta.lowConfCount;
}

export async function incrementLowConfCount(chatId: string): Promise<number> {
  const meta = await updateUserMeta(chatId, {lowConfCount: (await getUserMeta(chatId)).lowConfCount + 1});
  return meta.lowConfCount;
}

export async function resetLowConfCount(chatId: string): Promise<void> {
  await updateUserMeta(chatId, {lowConfCount: 0});
}

export async function getRelationshipStage(chatId: string): Promise<string> {
  const meta = await getUserMeta(chatId);
  return meta.relationshipStage;
}

export async function setRelationshipStage(chatId: string, stage: UserMeta["relationshipStage"]): Promise<void> {
  await updateUserMeta(chatId, {relationshipStage: stage});
}

export async function getFirstContactDate(chatId: string): Promise<Date | null> {
  const meta = await getUserMeta(chatId);
  return meta.firstContactDate ? new Date(meta.firstContactDate) : null;
}

export async function setFirstContactDate(chatId: string, date: Date): Promise<void> {
  await updateUserMeta(chatId, {firstContactDate: date.toISOString()});
}
