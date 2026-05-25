import type {Bot} from "grammy/web";
import {config} from "../config.js";
import {businessAssistantReply} from "../ai.js";
import {addMessage, getRecentHistory} from "../conversation-memory.js";

type RawUpdate = Record<string, unknown>;

const TG_API = "https://api.telegram.org/bot";

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
    console.log(
      `[Business] Connection ${bc.is_enabled ? "enabled" : "disabled"} for user ${bc.user_chat_id}`,
    );
    return;
  }

  if (!bm) return;

  const text = typeof bm.text === "string" ? bm.text.trim() : "";
  if (!text) return;

  const chatObj = bm.chat as Record<string, unknown> | undefined;
  const chatId = chatObj?.id as number | undefined;
  const connectionId = bm.business_connection_id as string | undefined;
  const messageId = bm.message_id as number | undefined;

  if (!chatId || !connectionId || !messageId) return;

  console.log(
    `[Business] Message from chat ${chatId}: "${text.slice(0, 100)}"`,
  );

  try {
    await fetch(tgApiUrl("readBusinessMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: chatId,
        message_id: messageId,
      }),
    });
  } catch (e) {
    console.error("[Business] Failed to mark as read:", e);
  }

  addMessage(chatId, "user", text);

  const history = getRecentHistory(chatId);
  const isFirstContact = history.length <= 1;

  let response: string;
  try {
    response = await businessAssistantReply(text, isFirstContact, history);
  } catch (error) {
    console.error("[Business] AI error:", error);
    response =
      "Hi! Bekzod is currently not online. He will get back to you as soon as he's available.";
  }

  addMessage(chatId, "assistant", response);

  try {
    const res = await fetch(tgApiUrl("sendMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: chatId,
        text: response,
        link_preview_options: {is_disabled: true},
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Business] API error: ${res.status} ${errText}`);
    }
  } catch (e) {
    console.error("[Business] Failed to send reply:", e);
  }
}
