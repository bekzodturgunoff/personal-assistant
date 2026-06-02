import {getLongTermKv} from "./store.js";

export async function setPausedUntil(chatId: string, untilISO: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(`paused:${chatId}`, untilISO);
}

export async function getPausedUntil(chatId: number): Promise<string | null> {
  const kv = getLongTermKv();
  if (!kv) return null;
  try {
    return await kv.get(`paused:${chatId}`);
  } catch {
    return null;
  }
}

export async function clearPausedUntil(chatId: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.delete?.(`paused:${chatId}`);
}
