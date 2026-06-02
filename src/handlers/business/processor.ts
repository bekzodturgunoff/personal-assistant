import type {GeminiResponse} from "../../lib/gemini.js";
import {businessAssistantReply} from "../../prompts/business.js";
import type {ReplyContext} from "../../prompts/business.js";
import {classifyIntent} from "../../lib/intent-classifier.js";
import {evaluateConfidence} from "../../lib/confidence-scorer.js";
import {getDuePendingReplies, getTimingState, saveTimingState, removePendingReply} from "../../lib/reply-timing.js";
import {getConversationsKv, getUserMeta, updateUserMeta, getWeeklyAccumulator, saveWeeklyAccumulator, getPausedUntil, clearPausedUntil} from "../../memory/index.js";
import {addMessage, getFullHistory} from "../../conversation-memory.js";
import {recordMessage, getPersona} from "../../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../../long-term-memory.js";
import {isChatMuted} from "../../lib/chat-state.js";
import {getConversationSummary, runBrainAnalysis} from "../../brain/brain.js";
import {getCachedSettings} from "../../lib/bot-settings/index.js";
import {readBusinessMessage, sendBusinessReply, alertOwnerAboutHandoff} from "./helpers.js";

interface PendingItem {
  chatId: number;
  connectionId: string;
  messageId: number;
  text: string;
  senderName: string;
  receivedAt: number;
  replyAfter: number;
  isUrgent: boolean;
}

import type {KvStore} from "../../memory/store.js";
type Kv = NonNullable<ReturnType<typeof getConversationsKv>>;

async function handleSkippedMuted(chatId: number, kv: Kv): Promise<true | void> {
  if (await isChatMuted(chatId)) {
    await removePendingReply(kv, chatId);
    return true;
  }
}

async function handleSkippedPaused(chatId: number): Promise<true | void> {
  const pausedUntil = await getPausedUntil(chatId);
  if (!pausedUntil) return;
  const pausedTime = new Date(pausedUntil).getTime();
  if (Date.now() < pausedTime) return true;
  await clearPausedUntil(String(chatId));
}

async function buildReplyContext(pending: PendingItem): Promise<ReplyContext> {
  const history = await getFullHistory(pending.chatId);
  const persona = await getPersona(pending.chatId);
  const longTermBlock = await getFactsBlock(pending.chatId);
  const summary = await getConversationSummary(pending.chatId);
  const storedMeta = await getUserMeta(String(pending.chatId));
  const intent = classifyIntent(pending.text);

  const allFacts = longTermBlock
    .replace(/^What I know about this person:\n- /, "")
    .split("\n- ")
    .filter(Boolean);

  const bizSettings = await getCachedSettings();
  let isReturning = false;
  let daysSinceLastContact = 0;
  try {
    const userMsgs = history.filter((e) => e.role === "user");
    if (userMsgs.length >= 2) {
      const prevMsg = userMsgs[userMsgs.length - 2];
      daysSinceLastContact = Math.floor((Date.now() - prevMsg.timestamp) / 86400000);
      isReturning = daysSinceLastContact > bizSettings.returningContactDays;
    }
  } catch (e) {
    console.error("[Business] Error checking returning contact:", e);
  }

  return {
    contactName: pending.senderName,
    daysKnown: persona.firstContactDate ? Math.floor((Date.now() - persona.firstContactDate) / 86400000) : 0,
    messageCount: persona.messageCount,
    relationshipStage: persona.relationshipStage,
    brainSummary: summary,
    topFacts: allFacts,
    sentiment: storedMeta.lastSentiment || "neutral",
    intent: storedMeta.lastIntent !== "other" ? storedMeta.lastIntent : intent.isPriceInquiry ? "price_inquiry" : intent.isComplaint ? "complaint" : intent.isGreeting ? "greeting" : "other",
    urgency: intent.estimatedUrgency,
    detectedLanguage: intent.detectedLanguage,
    pendingQuestions: storedMeta.pendingQuestions || [],
    isReturning,
    daysSinceLastContact,
  };
}

async function handleAiError(pending: PendingItem, kv: Kv): Promise<void> {
  const aiSettings = await getCachedSettings();
  const fallbackText = aiSettings.aiFallbackPhrases[Math.floor(Math.random() * aiSettings.aiFallbackPhrases.length)];
  await addMessage(pending.chatId, "assistant", fallbackText);
  await recordMessage(pending.chatId, "assistant", fallbackText);
  await sendBusinessReply(pending.connectionId, pending.chatId, fallbackText);
  const timing = await getTimingState(kv, pending.chatId);
  timing.lastOutgoingAt = Date.now();
  await saveTimingState(kv, pending.chatId, timing);
  await removePendingReply(kv, pending.chatId);
}

async function handleLowConfidence(
  pending: PendingItem,
  confidenceCheck: Awaited<ReturnType<typeof evaluateConfidence>>,
  replyCtx: ReplyContext,
): Promise<string> {
  const meta = await updateUserMeta(String(pending.chatId), { lowConfCount: (await getUserMeta(String(pending.chatId))).lowConfCount + 1 });
  const acc = await getWeeklyAccumulator();
  acc.lowConfTotal++;
  await saveWeeklyAccumulator(acc);

  const settings = await getCachedSettings();
  if (meta.lowConfCount >= settings.lowConfAlertThreshold) {
    await alertOwnerAboutHandoff(pending.chatId, pending.senderName);
    await updateUserMeta(String(pending.chatId), { lowConfCount: 0 });
  }

  const clarifierOptions = settings.confidence.clarifiers[replyCtx.intent];
  const clarifier = clarifierOptions
    ? clarifierOptions[Math.floor(Math.random() * clarifierOptions.length)]
    : null;

  return pending.isUrgent
    ? settings.confidence.fallbackPhrases[0] || "Hozir ko'ryapman, tezda javob beraman"
    : clarifier
      ? `${confidenceCheck.fallbackPhrase} — ${clarifier}`
      : confidenceCheck.fallbackPhrase;
}

async function completePendingReply(
  pending: PendingItem,
  responseText: string,
  kv: Kv,
): Promise<void> {
  await addMessage(pending.chatId, "assistant", responseText);
  await recordMessage(pending.chatId, "assistant", responseText);
  await extractAndStoreFact(pending.chatId, pending.text, responseText);
  await sendBusinessReply(pending.connectionId, pending.chatId, responseText);
  const timing = await getTimingState(kv, pending.chatId);
  timing.lastOutgoingAt = Date.now();
  await saveTimingState(kv, pending.chatId, timing);
  await removePendingReply(kv, pending.chatId);
  runBrainAnalysis(pending.chatId, pending.senderName).catch((err) =>
    console.error(`[Business] Brain analysis error:`, err),
  );
}

async function processOnePending(pending: PendingItem, kv: Kv): Promise<void> {
  if (await handleSkippedMuted(pending.chatId, kv)) return;
  if (await handleSkippedPaused(pending.chatId)) return;

  await readBusinessMessage(pending.connectionId, pending.chatId, pending.messageId);
  const replyCtx = await buildReplyContext(pending);

  const geminiResponse = await businessAssistantReply(
    pending.text,
    await getFullHistory(pending.chatId),
    replyCtx,
  ).catch(async (error) => {
    console.error(`[Business] AI call FAILED for pending ${pending.senderName} (${pending.chatId}):`, error);
    await handleAiError(pending, kv);
    return null;
  });

  if (!geminiResponse) return;

  const confidenceCheck = await evaluateConfidence(geminiResponse);
  const responseText = confidenceCheck.shouldFallback
    ? await handleLowConfidence(pending, confidenceCheck, replyCtx)
    : (await updateUserMeta(String(pending.chatId), { lowConfCount: 0 }), geminiResponse.text);

  await completePendingReply(pending, responseText, kv);
}

let isProcessingReplies = false;

export async function processDuePendingReplies(): Promise<void> {
  if (isProcessingReplies) {
    console.log("[Business] Already processing replies, skipping concurrent call");
    return;
  }
  isProcessingReplies = true;
  try {
    const kv = getConversationsKv();
    if (!kv) { isProcessingReplies = false; return; }
    const due = await getDuePendingReplies(kv, Date.now());
    if (due.length === 0) { isProcessingReplies = false; return; }
    await Promise.all(due.map((p) => processOnePending(p, kv).catch(async (e) => {
      console.error(`[Business] Failed to process pending reply for chat ${p.chatId}:`, e);
      await removePendingReply(kv, p.chatId).catch(() => {});
    })));
  } finally {
    isProcessingReplies = false;
  }
}
