import type {KvStore} from "./kv-store.js";
import {getCachedSettings} from "./bot-settings.js";

let kvBinding: KvStore | null = null;

export function setChatStateKv(kv: KvStore): void {
  kvBinding = kv;
}

const lastGroupReplyAt = new Map<number, number>();

function muteKey(chatId: number): string {
  return `muted:${chatId}`;
}

export async function isChatMuted(chatId: number): Promise<boolean> {
  if (kvBinding) {
    try {
      const raw = await kvBinding.get(muteKey(chatId));
      return raw === "true";
    } catch {
      return false;
    }
  }
  return false;
}

export async function muteChat(chatId: number, reason: string): Promise<void> {
  if (kvBinding) {
    await kvBinding.put(muteKey(chatId), "true");
    console.log(`[Mute] Chat ${chatId} muted — ${reason}`);
  }
}

export async function unmuteChat(chatId: number): Promise<void> {
  if (kvBinding) {
    await kvBinding.put(muteKey(chatId), "false");
    console.log(`[Mute] Chat ${chatId} unmuted`);
  }
}

export async function canReplyInGroup(chatId: number): Promise<boolean> {
  const settings = await getCachedSettings();
  const now = Date.now();
  const lastReplyAt = lastGroupReplyAt.get(chatId) ?? 0;
  if (now - lastReplyAt < settings.groupReplyCooldownMs) {
    return false;
  }
  lastGroupReplyAt.set(chatId, now);
  return true;
}
