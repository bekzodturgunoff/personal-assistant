import type {Bot} from "grammy/web";
import {config} from "../config.js";
import {businessAssistantReply} from "../prompts/business.js";
import type {ReplyContext} from "../prompts/business.js";
import type {GeminiResponse} from "../lib/gemini.js";
import {evaluateConfidence} from "../lib/confidence-scorer.js";
import {classifyIntent} from "../lib/intent-classifier.js";
import {addMessage, getFullHistory} from "../conversation-memory.js";
import {recordMessage, buildPersonaBlock, getPersona} from "../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../long-term-memory.js";
import {isChatMuted} from "../lib/chat-state.js";
import {getConversationSummary, runBrainAnalysis} from "../brain/brain.js";
import {
  getTimingState,
  saveTimingState,
  calculateReplyAt,
  addPendingReply,
  getDuePendingReplies,
  removePendingReply,
} from "../lib/reply-timing.js";
import {
  getConversationsKv,
  getUserMeta,
  updateUserMeta,
  getWeeklyAccumulator,
  saveWeeklyAccumulator,
  touchDailyEntry,
  getPausedUntil,
  clearPausedUntil,
} from "../lib/kv-store.js";

interface BusinessMessageShape {
  text?: unknown;
  voice?: unknown;
  sticker?: unknown;
  forward_origin?: unknown;
}

type RawUpdate = Record<string, unknown>;

function shouldSkipReply(msg: BusinessMessageShape): boolean {
  try {
    if (msg.sticker) {
      console.log("[SKIP] sticker message");
      return true;
    }

    const hasVoice = !!msg.voice;
    const text = typeof msg.text === "string" ? msg.text.trim() : "";

    if (!text && !hasVoice) {
      console.log("[SKIP] no text and no voice");
      return true;
    }

    if (msg.forward_origin && !text) {
      console.log("[SKIP] forwarded post with no added text");
      return true;
    }

    if (!text) return false;

    if (/^(ok|okay|yaxshi|bo'pti|tushunarli|mayli|ha|xo'p|хорошо|ладно|понял|ок)\.?$/i.test(text)) {
      console.log(`[SKIP] short acknowledgment: "${text.slice(0, 30)}"`);
      return true;
    }

    if (/^\p{Emoji_Presentation}+$/u.test(text)) {
      console.log(`[SKIP] single emoji: "${text.slice(0, 30)}"`);
      return true;
    }

    if (/^[.!?…,]+$/.test(text)) {
      console.log(`[SKIP] only punctuation: "${text.slice(0, 30)}"`);
      return true;
    }

    if (text.length < 3) {
      console.log(`[SKIP] text too short: "${text.slice(0, 30)}"`);
      return true;
    }

    return false;
  } catch (e) {
    console.error("[SKIP] error in shouldSkipReply:", e);
    return false;
  }
}

const TG_API = "https://api.telegram.org/bot";

const LOWCONF_ALERT_THRESHOLD = 3;

let ownerChatId: number | null = null;

function tgApiUrl(method: string): string {
  return `${TG_API}${config.telegramBotToken}/${method}`;
}

export function isBusinessUpdate(update: RawUpdate): boolean {
  return !!(
    update.business_connection ||
    update.business_message ||
    update.edited_business_message
  );
}

async function readBusinessMessage(connectionId: string, chatId: number, messageId: number): Promise<void> {
  try {
    await fetch(tgApiUrl("readBusinessMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: chatId,
        message_id: messageId,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[Business] Failed to mark as read:", e);
  }
}

function calculateTypingDuration(text: string): number {
  const msPerChar = 45;
  const duration = text.length * msPerChar;
  return Math.min(Math.max(duration, 0), 4000);
}

async function sendWithTyping(connectionId: string, chatId: number, text: string): Promise<void> {
  const typingDuration = calculateTypingDuration(text);

  try {
    await fetch(tgApiUrl("sendChatAction"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: chatId,
        action: "typing",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[Business] Failed to send typing action:", e);
  }

  await new Promise((resolve) => setTimeout(resolve, typingDuration));

  try {
    const res = await fetch(tgApiUrl("sendMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: chatId,
        text,
        link_preview_options: {is_disabled: true},
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Business] API error: ${res.status} ${errText}`);
    }
  } catch (e) {
    console.error("[Business] Failed to send reply:", e);
  }
}

async function sendBusinessReply(connectionId: string, chatId: number, text: string): Promise<void> {
  await sendWithTyping(connectionId, chatId, text);
}

async function alertOwnerAboutHandoff(chatId: number, senderName: string): Promise<void> {
  const ownerId = config.ownerUserId;
  if (!ownerId) return;
  console.log(`[Business] Low-confidence threshold reached for ${senderName} (${chatId}), alerting owner`);
  try {
    await fetch(tgApiUrl("sendMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        chat_id: ownerId,
        text: `⚠️ Handoff needed: I'm stuck in conversation with ${senderName} (chat ${chatId}). Low confidence on 3+ replies. Please take over.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("[Business] Failed to alert owner:", e);
  }
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

    const now = Date.now();
    const due = await getDuePendingReplies(kv, now);
    if (due.length === 0) { isProcessingReplies = false; return; }

    console.log(`[Business] Processing ${due.length} due pending replies`);

    for (const pending of due) {
    try {
      if (await isChatMuted(pending.chatId)) {
        console.log(`[Business] Chat ${pending.chatId} is muted, skipping pending reply`);
        await removePendingReply(kv, pending.chatId);
        continue;
      }

      const pausedUntil = await getPausedUntil(pending.chatId);
      if (pausedUntil) {
        const pausedTime = new Date(pausedUntil).getTime();
        if (Date.now() < pausedTime) {
          console.log(`[Business] Chat ${pending.chatId} is paused until ${pausedUntil}, skipping`);
          continue;
        }
        await clearPausedUntil(String(pending.chatId));
      }

      await readBusinessMessage(pending.connectionId, pending.chatId, pending.messageId);

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

      let isReturning = false;
      let daysSinceLastContact = 0;
      try {
        const userMsgs = history.filter((e) => e.role === "user");
        if (userMsgs.length >= 2) {
          const prevMsg = userMsgs[userMsgs.length - 2];
          daysSinceLastContact = Math.floor((Date.now() - prevMsg.timestamp) / 86400000);
          isReturning = daysSinceLastContact > 7;
        }
      } catch (e) {
        console.error("[Business] Error checking returning contact:", e);
      }

      const replyCtx: ReplyContext = {
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

      let geminiResponse: GeminiResponse;
      try {
        geminiResponse = await businessAssistantReply(
          pending.text,
          history,
          replyCtx,
        );
      } catch (error) {
        console.error(`[Business] AI call FAILED for pending ${pending.senderName} (${pending.chatId}):`, error);
        const fallbacks = [
          "Hozir bandman, keyinroq javob beraman",
          "Sal gaplashamiz keyin, hozir ish bilan bandman",
          "Keyinroq yozaman, hozir biroz band",
          "Hozir qo'lim tegmayapti, keyin albatta javob beraman",
          "Hozir boshqa ish bilan bandman, keyin yozaman",
        ];
        const fallbackText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        await addMessage(pending.chatId, "assistant", fallbackText);
        await recordMessage(pending.chatId, "assistant", fallbackText);
        await sendBusinessReply(pending.connectionId, pending.chatId, fallbackText);

        const timing = await getTimingState(kv, pending.chatId);
        timing.lastOutgoingAt = Date.now();
        await saveTimingState(kv, pending.chatId, timing);
        await removePendingReply(kv, pending.chatId);
        continue;
      }

      const confidenceCheck = evaluateConfidence(geminiResponse);
      console.log(`[Business] confidenceCheck: score=${confidenceCheck.score}, factual=${confidenceCheck.isFactualClaim}, fallback=${confidenceCheck.shouldFallback}`);

      let responseText: string;
      if (confidenceCheck.shouldFallback) {
        const meta = await updateUserMeta(String(pending.chatId), { lowConfCount: (await getUserMeta(String(pending.chatId))).lowConfCount + 1 });
        console.log(`[Business] Low confidence fallback for ${pending.senderName}, lowconf count=${meta.lowConfCount}`);

        const acc = await getWeeklyAccumulator();
        acc.lowConfTotal++;
        await saveWeeklyAccumulator(acc);

        if (meta.lowConfCount >= LOWCONF_ALERT_THRESHOLD) {
          await alertOwnerAboutHandoff(pending.chatId, pending.senderName);
          await updateUserMeta(String(pending.chatId), { lowConfCount: 0 });
        }

        const clarifiers: Record<string, string[]> = {
          price_inquiry: [
            "Bu qaysi mahsulot uchun edi?",
            "Qancha miqdor kerak edi?",
            "Qachonga kerak?",
          ],
          request: [
            "Aniqroq aytib bera olasizmi?",
            "Qachonga kerak?",
          ],
        };
        const clarifierOptions = clarifiers[replyCtx.intent];
        const clarifier = clarifierOptions
          ? clarifierOptions[Math.floor(Math.random() * clarifierOptions.length)]
          : null;

        responseText = pending.isUrgent
          ? "Hozir ko'ryapman, tezda javob beraman"
          : clarifier
            ? `${confidenceCheck.fallbackPhrase} — ${clarifier}`
            : confidenceCheck.fallbackPhrase;
      } else {
        await updateUserMeta(String(pending.chatId), { lowConfCount: 0 });
        responseText = geminiResponse.text;
      }

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
    } catch (e) {
      console.error(`[Business] Failed to process pending reply for chat ${pending.chatId}:`, e);
    }
  }
  } finally {
    isProcessingReplies = false;
  }
}

export async function handleBusinessUpdate(
  _bot: Bot,
  update: RawUpdate,
): Promise<void> {
  const bc = update.business_connection as
    | Record<string, unknown>
    | undefined;
  const bm = (update.business_message ||
    update.edited_business_message) as Record<string, unknown> | undefined;

  if (bc) {
    ownerChatId = typeof bc.user_chat_id === "number" ? bc.user_chat_id : null;
    console.log(
      `[Business] Connection ${bc.is_enabled ? "enabled" : "disabled"} for user ${bc.user_chat_id}`,
    );
    return;
  }

  if (!bm) return;

  const text = typeof bm.text === "string" ? bm.text.trim() : "";
  if (!text) return;

  const fromObj = bm.from as Record<string, unknown> | undefined;
  const senderId = fromObj?.id as number | undefined;
  const senderName = [fromObj?.first_name, fromObj?.last_name]
    .filter(Boolean)
    .join(" ") || fromObj?.username as string | undefined || "Someone";

  if (fromObj?.is_bot === true) {
    console.log(`[Business] Skipping message from bot (${senderId})`);
    return;
  }

  if (senderId && senderId === ownerChatId) {
    console.log(`[Business] Skipping own message from owner (${senderId})`);
    return;
  }

  const chatObj = bm.chat as Record<string, unknown> | undefined;
  const chatId = chatObj?.id as number | undefined;
  const connectionId = bm.business_connection_id as string | undefined;
  const messageId = bm.message_id as number | undefined;

  if (!chatId || !connectionId || !messageId) return;

  const meta = await getUserMeta(String(chatId));
  if (!meta.businessConnectionId) {
    await updateUserMeta(String(chatId), { businessConnectionId: connectionId });
  }

  if (await isChatMuted(chatId)) {
    console.log(`[Business] Chat ${chatId} is muted, skipping`);
    return;
  }

  console.log(
    `[Business] Message from ${senderName} (${chatId}): "${text.slice(0, 100)}"`,
  );

  await addMessage(chatId, "user", text);
  await recordMessage(chatId, "user", text);

  await updateUserMeta(String(chatId), { lastMessageTimestamp: Date.now() });

  if (shouldSkipReply(bm as BusinessMessageShape)) {
    runBrainAnalysis(chatId, senderName).catch((err) =>
      console.error(`[Business] Brain analysis error:`, err),
    );
    return;
  }

  // ── Intent classification (pre-filter, no AI call) ──
  const intent = classifyIntent(text);
  console.log(`[Business] Intent: urgent=${intent.isUrgent}, lang=${intent.detectedLanguage}, type=${intent.isGreeting ? "greeting" : intent.isPriceInquiry ? "price" : intent.isComplaint ? "complaint" : "other"}, urgency=${intent.estimatedUrgency}`);

  const kv = getConversationsKv();

  if (kv) {
    const timing = await getTimingState(kv, chatId);
    timing.lastIncomingAt = Date.now();
    timing.messageCount++;
    if (timing.conversationStartedAt === 0) {
      timing.conversationStartedAt = Date.now();
    }

    if (intent.isUrgent) {
      timing.lastOutgoingAt = 0;
    }

    const replyAt = intent.isUrgent ? Date.now() : calculateReplyAt(timing, Date.now());
    const waitSeconds = Math.round((replyAt - Date.now()) / 1000);
    console.log(`[Business] ${senderName}: reply scheduled in ~${waitSeconds}s (message #${timing.messageCount})${intent.isUrgent ? " [URGENT]" : ""}`);

    await saveTimingState(kv, chatId, timing);

    const pending = {
      chatId,
      connectionId,
      messageId,
      text,
      senderName,
      receivedAt: Date.now(),
      replyAfter: replyAt,
      isUrgent: intent.isUrgent,
    };

    await addPendingReply(kv, pending);

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
}