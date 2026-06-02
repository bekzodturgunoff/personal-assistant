import type {KvStore} from "../memory/index.js";
import {getCachedSettings} from "./bot-settings/index.js";

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

const PENDING_INDEX_KEY = "_pending_idx";

function pendingKey(chatId: number): string {
  return `pending:${chatId}`;
}

interface IndexEntry {
  chatId: number;
  replyAfter: number;
}

async function readIndex(kv: KvStore): Promise<IndexEntry[]> {
  try {
    const raw = await kv.get(PENDING_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeIndex(kv: KvStore, index: IndexEntry[]): Promise<void> {
  await kv.put(PENDING_INDEX_KEY, JSON.stringify(index));
}

export async function addPendingReply(kv: KvStore, reply: PendingReply): Promise<void> {
  await kv.put(pendingKey(reply.chatId), JSON.stringify(reply));
  const index = await readIndex(kv);
  if (!index.some((e) => e.chatId === reply.chatId)) {
    index.push({chatId: reply.chatId, replyAfter: reply.replyAfter});
    await writeIndex(kv, index);
  }
}

export async function getDuePendingReplies(kv: KvStore, now: number): Promise<PendingReply[]> {
  const index = await readIndex(kv);
  const due: PendingReply[] = [];
  const stale: number[] = [];

  for (const entry of index) {
    if (entry.replyAfter > now) continue;
    try {
      const raw = await kv.get(pendingKey(entry.chatId));
      if (!raw) { stale.push(entry.chatId); continue; }
      const reply = JSON.parse(raw) as PendingReply;
      if (reply.replyAfter <= now || reply.isUrgent) {
        due.push(reply);
      }
    } catch {
      stale.push(entry.chatId);
    }
  }

  if (stale.length > 0) {
    const cleaned = index.filter((e) => !stale.includes(e.chatId));
    await writeIndex(kv, cleaned);
  }

  return due;
}

export async function removePendingReply(kv: KvStore, chatId: number): Promise<void> {
  await kv.delete?.(pendingKey(chatId));
  const index = await readIndex(kv);
  const filtered = index.filter((e) => e.chatId !== chatId);
  if (filtered.length < index.length) {
    await writeIndex(kv, filtered);
  }
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
