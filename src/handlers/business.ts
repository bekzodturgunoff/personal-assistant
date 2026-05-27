import type {Bot} from "grammy/web";
import {config} from "../config.js";
import {businessAssistantReply} from "../prompts/business.js";
import {addMessage, getRecentHistory} from "../conversation-memory.js";
import {recordMessage, buildPersonaBlock} from "../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../long-term-memory.js";

type RawUpdate = Record<string, unknown>;

const TG_API = "https://api.telegram.org/bot";

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

  const shortText = text.toLowerCase().trim();
  if (!shortText || /^(ok|lol|ha+)$/.test(shortText)) {
    console.log(`[Business] Ignoring short/spam message: "${text}"`);
    return;
  }

  console.log(
    `[Business] Message from ${senderName} (${chatId}): "${text.slice(0, 100)}" → routing to businessAssistantReply`,
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

  await addMessage(chatId, "user", text);
  await recordMessage(chatId, "user", text);

  const history = await getRecentHistory(chatId);
  const isFirstContact = history.length <= 1;
  const personaBlock = await buildPersonaBlock(chatId);
  const longTermBlock = await getFactsBlock(chatId);
  const fullContext = [personaBlock, longTermBlock].filter(Boolean).join("\n");

  let response: string;
  try {
    response = await businessAssistantReply(
      text,
      isFirstContact,
      history,
      senderName,
      fullContext,
    );
  } catch (error) {
    console.error(`[Business] AI call FAILED for ${senderName} (${chatId}): "${text.slice(0, 80)}"`, error);
    return;
  }

  await addMessage(chatId, "assistant", response);
  await recordMessage(chatId, "assistant", response);
  await extractAndStoreFact(chatId, text, response);

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
