import {config} from "../../config/env.js";

interface BusinessMessageShape {
  text?: unknown;
  voice?: unknown;
  sticker?: unknown;
  forward_origin?: unknown;
}

export type RawUpdate = Record<string, unknown>;

export function shouldSkipReply(msg: BusinessMessageShape): boolean {
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
let ownerChatId: number | null = null;

export {TG_API, ownerChatId};

export function setOwnerChatId(id: number | null): void {
  ownerChatId = id;
}

export function getOwnerChatId(): number | null {
  return ownerChatId;
}

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

export async function readBusinessMessage(connectionId: string, chatId: number, messageId: number): Promise<void> {
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

export async function sendWithTyping(connectionId: string, chatId: number, text: string): Promise<void> {
  const settings = await (await import("../../lib/bot-settings/index.js")).getCachedSettings();
  const typingDuration = Math.min(Math.max(text.length * settings.typingMsPerChar, 0), settings.typingMaxMs);

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

export async function sendBusinessReply(connectionId: string, chatId: number, text: string): Promise<void> {
  await sendWithTyping(connectionId, chatId, text);
}

export async function alertOwnerAboutHandoff(chatId: number, senderName: string): Promise<void> {
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
