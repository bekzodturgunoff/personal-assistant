import type {Bot} from "grammy/web";
import {classifyIntent, type IntentSignals} from "../../lib/intent-classifier.js";
import {getConversationsKv, getUserMeta, updateUserMeta, getWeeklyAccumulator, saveWeeklyAccumulator} from "../../memory/index.js";
import {addMessage} from "../../conversation-memory.js";
import {recordMessage} from "../../persona-memory.js";
import {isChatMuted} from "../../lib/chat-state.js";
import {runBrainAnalysis} from "../../brain/brain.js";
import {getTimingState, saveTimingState, calculateReplyAt, addPendingReply} from "../../lib/reply-timing.js";
import {touchDailyEntry} from "../../memory/index.js";
import {shouldSkipReply, setOwnerChatId, getOwnerChatId} from "./helpers.js";
import type {RawUpdate} from "./helpers.js";

interface MessageInfo {
  text: string;
  senderId: number | undefined;
  senderName: string;
  chatId: number;
  connectionId: string;
  messageId: number;
  bm: Record<string, unknown>;
  isBot: boolean;
}

function handleConnectionUpdate(update: RawUpdate): boolean {
  const bc = update.business_connection as Record<string, unknown> | undefined;
  if (!bc) return false;
  setOwnerChatId(typeof bc.user_chat_id === "number" ? bc.user_chat_id : null);
  console.log(`[Business] Connection ${bc.is_enabled ? "enabled" : "disabled"} for user ${bc.user_chat_id}`);
  return true;
}

function parseBusinessMessage(update: RawUpdate): MessageInfo | null {
  const bm = (update.business_message || update.edited_business_message) as Record<string, unknown> | undefined;
  if (!bm) return null;

  const text = typeof bm.text === "string" ? bm.text.trim() : "";
  if (!text) return null;

  const fromObj = bm.from as Record<string, unknown> | undefined;
  const senderId = fromObj?.id as number | undefined;
  const senderName = [fromObj?.first_name, fromObj?.last_name]
    .filter(Boolean)
    .join(" ") || fromObj?.username as string | undefined || "Someone";

  const chatObj = bm.chat as Record<string, unknown> | undefined;
  const chatId = chatObj?.id as number | undefined;
  const connectionId = bm.business_connection_id as string | undefined;
  const messageId = bm.message_id as number | undefined;

  if (!chatId || !connectionId || !messageId) return null;

  return {text, senderId, senderName, chatId, connectionId, messageId, bm, isBot: fromObj?.is_bot === true};
}

function getSkipReason(info: MessageInfo): string | null {
  if (info.isBot) {
    console.log(`[Business] Skipping message from bot (${info.senderId})`);
    return "bot";
  }
  const ocId = getOwnerChatId();
  if (info.senderId && info.senderId === ocId) {
    console.log(`[Business] Skipping own message from owner (${info.senderId})`);
    return "owner";
  }
  return null;
}

async function initializeChat(chatId: number, connectionId: string): Promise<boolean> {
  const meta = await getUserMeta(String(chatId));
  if (!meta.businessConnectionId) {
    await updateUserMeta(String(chatId), {businessConnectionId: connectionId});
  }
  if (await isChatMuted(chatId)) {
    console.log(`[Business] Chat ${chatId} is muted, skipping`);
    return false;
  }
  return true;
}

async function logAndRecordIncoming(chatId: number, senderName: string, text: string): Promise<void> {
  console.log(`[Business] Message from ${senderName} (${chatId}): "${text.slice(0, 100)}"`);
  await addMessage(chatId, "user", text);
  await recordMessage(chatId, "user", text);
  await updateUserMeta(String(chatId), {lastMessageTimestamp: Date.now()});
}

async function handleSkipReply(info: MessageInfo): Promise<boolean> {
  if (!shouldSkipReply(info.bm as {text?: unknown; voice?: unknown; sticker?: unknown; forward_origin?: unknown})) {
    return false;
  }
  runBrainAnalysis(info.chatId, info.senderName).catch((err) =>
    console.error(`[Business] Brain analysis error:`, err),
  );
  return true;
}

async function updateAnalytics(chatId: number, intent: IntentSignals): Promise<void> {
  const acc = await getWeeklyAccumulator();
  acc.totalMessages++;
  const cid = String(chatId);
  if (!acc.conversationsSeen.includes(cid)) {
    acc.conversationsSeen.push(cid);
  }
  acc.chatMessages[cid] = (acc.chatMessages[cid] || 0) + 1;
  const lang = intent.detectedLanguage as keyof typeof acc.languageBreakdown;
  if (lang in acc.languageBreakdown) acc.languageBreakdown[lang]++;
  touchDailyEntry(acc, 1, 0);
  await saveWeeklyAccumulator(acc);
}

async function schedulePendingReply(
  chatId: number,
  connectionId: string,
  messageId: number,
  text: string,
  senderName: string,
  intent: IntentSignals,
): Promise<void> {
  const kv = getConversationsKv();
  if (!kv) return;
  const timing = await getTimingState(kv, chatId);
  timing.lastIncomingAt = Date.now();
  timing.messageCount++;
  if (timing.conversationStartedAt === 0) {
    timing.conversationStartedAt = Date.now();
  }
  if (intent.isUrgent) {
    timing.lastOutgoingAt = 0;
  }
  const replyAt = intent.isUrgent ? Date.now() : await calculateReplyAt(timing, Date.now());
  const waitSeconds = Math.round((replyAt - Date.now()) / 1000);
  console.log(`[Business] ${senderName}: reply scheduled in ~${waitSeconds}s (message #${timing.messageCount})${intent.isUrgent ? " [URGENT]" : ""}`);
  await saveTimingState(kv, chatId, timing);
  await addPendingReply(kv, {
    chatId,
    connectionId,
    messageId,
    text,
    senderName,
    receivedAt: Date.now(),
    replyAfter: replyAt,
    isUrgent: intent.isUrgent,
  });
  await updateAnalytics(chatId, intent);
}

export async function handleBusinessUpdate(
  _bot: Bot,
  update: RawUpdate,
): Promise<void> {
  if (handleConnectionUpdate(update)) return;

  const info = parseBusinessMessage(update);
  if (!info) return;

  if (getSkipReason(info)) return;
  if (!(await initializeChat(info.chatId, info.connectionId))) return;

  await logAndRecordIncoming(info.chatId, info.senderName, info.text);

  if (await handleSkipReply(info)) return;

  const intent = classifyIntent(info.text);
  console.log(`[Business] Intent: urgent=${intent.isUrgent}, lang=${intent.detectedLanguage}, type=${intent.isGreeting ? "greeting" : intent.isPriceInquiry ? "price" : intent.isComplaint ? "complaint" : "other"}, urgency=${intent.estimatedUrgency}`);

  await schedulePendingReply(info.chatId, info.connectionId, info.messageId, info.text, info.senderName, intent);
}
