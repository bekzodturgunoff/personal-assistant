import {config} from "../../config/env.js";
import {getPersona} from "../../persona-memory.js";

const TG_API = "https://api.telegram.org/bot";
export const OWNER_ID = config.ownerUserId;

export function tgUrl(method: string): string {
  return `${TG_API}${config.telegramBotToken}/${method}`;
}

export function isOwner(ctx: {from?: {id?: number} | null}): boolean {
  return ctx.from?.id === OWNER_ID;
}

export async function getContactName(chatId: number | string): Promise<string> {
  try {
    const persona = await getPersona(Number(chatId));
    return persona && persona.messageCount > 0 ? `Chat ${chatId}` : String(chatId);
  } catch {
    return String(chatId);
  }
}

export function parseChatId(text: string): number | null {
  const parts = text.split(/\s+/);
  const idStr = parts[1];
  if (!idStr) return null;
  const n = Number(idStr);
  return Number.isNaN(n) ? null : n;
}

export function parseChatIdAndRest(text: string): {chatId: number | null; rest: string} {
  const parts = text.split(/\s+/);
  const idStr = parts[1];
  if (!idStr) return {chatId: null, rest: ""};
  const n = Number(idStr);
  if (Number.isNaN(n)) return {chatId: null, rest: ""};
  return {chatId: n, rest: parts.slice(2).join(" ")};
}

export async function sendBusinessMessage(businessConnectionId: string, chatId: number, text: string): Promise<boolean> {
  try {
    const res = await fetch(tgUrl("sendMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: businessConnectionId,
        chat_id: chatId,
        text,
        link_preview_options: {is_disabled: true},
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
