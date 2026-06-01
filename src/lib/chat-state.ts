import type {KvStore} from "./kv-store.js";

let kvBinding: KvStore | null = null;

export function setChatStateKv(kv: KvStore): void {
  kvBinding = kv;
}

const GROUP_REPLY_COOLDOWN_MS = 12_000;
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

export function canReplyInGroup(chatId: number): boolean {
  const now = Date.now();
  const lastReplyAt = lastGroupReplyAt.get(chatId) ?? 0;
  if (now - lastReplyAt < GROUP_REPLY_COOLDOWN_MS) {
    return false;
  }
  lastGroupReplyAt.set(chatId, now);
  return true;
}
