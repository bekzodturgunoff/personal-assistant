const mutedChats = new Map<number, {reason: string; mutedAt: number}>();
const lastGroupReplyAt = new Map<number, number>();
const GROUP_REPLY_COOLDOWN_MS = 12_000;

export function isChatMuted(chatId: number): boolean {
  return mutedChats.has(chatId);
}

export function muteChat(chatId: number, reason: string): void {
  mutedChats.set(chatId, {reason, mutedAt: Date.now()});
}

export function unmuteChat(chatId: number): void {
  mutedChats.delete(chatId);
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
