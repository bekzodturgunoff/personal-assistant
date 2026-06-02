import {getLongTermKv, getConversationsKv} from "./store.js";

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
