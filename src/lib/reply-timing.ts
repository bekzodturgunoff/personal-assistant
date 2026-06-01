import type {KvStore} from "./kv-store.js";

const CONVERSATION_GAP_MS = 30 * 60 * 1000;
const MIN_FIRST_REPLY_DELAY_MS = 4 * 60 * 1000;
const MIN_SLOW_REPLY_DELAY_MS = 4 * 60 * 1000;
const MIN_NORMAL_REPLY_DELAY_MS = 90 * 1000;
const SLOW_THRESHOLD_MS = 3 * 60 * 1000;

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

function randomExtra(): number {
  return Math.floor(Math.random() * 120_000);
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

export function calculateReplyAt(state: ChatTimingState, now: number): number {
  const timeSinceLastOutgoing = state.lastOutgoingAt > 0 ? now - state.lastOutgoingAt : Infinity;
  const isNewConversation = timeSinceLastOutgoing > CONVERSATION_GAP_MS || state.messageCount === 0;

  if (isNewConversation) {
    return now + MIN_FIRST_REPLY_DELAY_MS + randomExtra();
  }

  if (state.lastOutgoingAt > 0 && state.lastIncomingAt > state.lastOutgoingAt) {
    const otherPersonReplyTime = state.lastIncomingAt - state.lastOutgoingAt;
    if (otherPersonReplyTime > SLOW_THRESHOLD_MS) {
      return now + MIN_SLOW_REPLY_DELAY_MS + randomExtra();
    }
  }

  return now + MIN_NORMAL_REPLY_DELAY_MS + randomExtra();
}

const PENDING_LIST_KEY = "_pending_replies";

export async function addPendingReply(kv: KvStore, reply: PendingReply): Promise<void> {
  const raw = await kv.get(PENDING_LIST_KEY);
  const list: PendingReply[] = raw ? JSON.parse(raw) : [];
  const filtered = list.filter((r) => r.chatId !== reply.chatId);
  filtered.push(reply);
  await kv.put(PENDING_LIST_KEY, JSON.stringify(filtered));
}

export async function getDuePendingReplies(kv: KvStore, now: number): Promise<PendingReply[]> {
  const raw = await kv.get(PENDING_LIST_KEY);
  if (!raw) return [];
  const list: PendingReply[] = JSON.parse(raw);
  return list.filter((r) => r.replyAfter <= now || r.isUrgent);
}

export async function removePendingReply(kv: KvStore, chatId: number): Promise<void> {
  const raw = await kv.get(PENDING_LIST_KEY);
  if (!raw) return;
  const list: PendingReply[] = JSON.parse(raw);
  const filtered = list.filter((r) => r.chatId !== chatId);
  await kv.put(PENDING_LIST_KEY, JSON.stringify(filtered));
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
