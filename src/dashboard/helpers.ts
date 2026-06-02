import {getPersona} from "../persona-memory.js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"},
  });
}

export async function getContactName(chatId: string): Promise<string> {
  try {
    const persona = await getPersona(Number(chatId));
    if (persona && persona.messageCount > 0) return `Chat ${chatId}`;
  } catch { /* ignore */ }
  return chatId;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
