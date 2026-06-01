import type {KvStore} from "./kv-store.js";
import {getCachedSettings} from "./bot-settings.js";

export interface ChatTimingState {
  lastIncomingAt: number;
  lastOutgoingAt: number;
  conversationStartedAt: number;
  messageCount: number;
}

export interface PendingReply {
  chatId: number;
  connectionId: string;
  messageId: number;
  text: string;
  senderName: string;
  receivedAt: number;
  replyAfter: number;
  isUrgent: boolean;
}

export function getDefaultTimingState(): ChatTimingState {
  return {lastIncomingAt: 0, lastOutgoingAt: 0, conversationStartedAt: 0, messageCount: 0};
}

export async function getTimingState(kv: KvStore, chatId: number): Promise<ChatTimingState> {
  const raw = await kv.get(`timing:${chatId}`);
  return raw ? JSON.parse(raw) : getDefaultTimingState();
}

export async function saveTimingState(kv: KvStore, chatId: number, state: ChatTimingState): Promise<void> {
  await kv.put(`timing:${chatId}`, JSON.stringify(state));
}

export async function calculateReplyAt(state: ChatTimingState, now: number): Promise<number> {
  const settings = await getCachedSettings();
  const t = settings.replyTiming;

  const conversationGapMs = t.conversationGapMinutes * 60 * 1000;
  const firstReplyDelayMs = t.firstReplyDelaySeconds * 1000;
  const slowReplyDelayMs = t.slowReplyDelaySeconds * 1000;
  const normalReplyDelayMs = t.normalReplyDelaySeconds * 1000;
  const slowThresholdMs = t.slowThresholdSeconds * 1000;
  const randomExtraMs = Math.floor(Math.random() * t.randomExtraMaxSeconds * 1000);

  const timeSinceLastOutgoing = state.lastOutgoingAt > 0 ? now - state.lastOutgoingAt : Infinity;
  const isNewConversation = timeSinceLastOutgoing > conversationGapMs || state.messageCount === 0;

  if (isNewConversation) {
    return now + firstReplyDelayMs + randomExtraMs;
  }

  if (state.lastOutgoingAt > 0 && state.lastIncomingAt > state.lastOutgoingAt) {
    const otherPersonReplyTime = state.lastIncomingAt - state.lastOutgoingAt;
    if (otherPersonReplyTime > slowThresholdMs) {
      return now + slowReplyDelayMs + randomExtraMs;
    }
  }

  return now + normalReplyDelayMs + randomExtraMs;
}

function pendingKey(chatId: number): string {
  return `pending:${chatId}`;
}

export async function addPendingReply(kv: KvStore, reply: PendingReply): Promise<void> {
  await kv.put(pendingKey(reply.chatId), JSON.stringify(reply));
}

export async function getDuePendingReplies(kv: KvStore, now: number): Promise<PendingReply[]> {
  if (!kv.list) return [];

  const result = await kv.list({prefix: "pending:"});
  const due: PendingReply[] = [];

  for (const key of result.keys) {
    try {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      const reply = JSON.parse(raw) as PendingReply;
      if (reply.replyAfter <= now || reply.isUrgent) {
        due.push(reply);
      }
    } catch {
      continue;
    }
  }

  return due;
}

export async function removePendingReply(kv: KvStore, chatId: number): Promise<void> {
  await kv.delete?.(pendingKey(chatId));
}

export async function getPendingReply(kv: KvStore, chatId: number): Promise<PendingReply | null> {
  try {
    const raw = await kv.get(pendingKey(chatId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingReply;
  } catch {
    return null;
  }
}

export function formatTashkentTime(): string {
  const now = new Date();
  const tashkent = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent",
    dateStyle: "full",
    timeStyle: "short",
    hour12: false,
  }).format(now);
  const offset = "+05:00";
  return `${tashkent} (UTC${offset})`;
}
