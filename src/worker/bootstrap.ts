import {createBot} from "../bot.js";
import {config} from "../config/env.js";
import {setKvBinding} from "../conversation-memory.js";
import {setKvBinding as setPersonaKv} from "../persona-memory.js";
import {setConversationsKv, setTasksKv, setLongTermKv, setModelCooldownKv} from "../memory/index.js";
import {setChatStateKv} from "../lib/chat-state.js";

type RuntimeBindings = Record<string, unknown>;

let botInstance: ReturnType<typeof createBot> | undefined;

export function getBot(): ReturnType<typeof createBot> {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

export function setupKvBindings(env: RuntimeBindings): void {
  const bindings = env as Record<string, unknown>;
  const conversations = bindings.CONVERSATIONS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  const tasks = bindings.TASKS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  const longTerm = bindings.LONG_TERM_MEMORY as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  if (conversations) { setKvBinding(conversations); setPersonaKv(conversations); setConversationsKv(conversations); setModelCooldownKv(conversations); setChatStateKv(conversations); }
  if (tasks) setTasksKv(tasks);
  if (longTerm) setLongTermKv(longTerm);
}

export async function ensureTelegramWebhook(bot: ReturnType<typeof createBot>, origin: string): Promise<void> {
  const webhookUrl = `${origin.replace(/\/+$/, "")}/api/webhooks/telegram`;
  try {
    const secretToken = config.webhookSecret || undefined;
    await bot.api.setWebhook(webhookUrl, {
      drop_pending_updates: true,
      secret_token: secretToken,
    });
    console.log(`Telegram webhook set to ${webhookUrl}${secretToken ? " with secret token" : ""}`);
  } catch (error) {
    console.warn("Failed to set Telegram webhook:", error);
  }
}

export async function getTelegramDebugInfo(bot: ReturnType<typeof createBot>, origin: string): Promise<Response> {
  try {
    const [me, webhookInfo] = await Promise.all([
      bot.api.getMe(),
      bot.api.getWebhookInfo(),
    ]);
    return Response.json({
      ok: true,
      bot: {id: me.id, username: me.username, first_name: me.first_name},
      webhook: webhookInfo,
      expectedWebhookUrl: `${origin.replace(/\/+$/, "")}/api/webhooks/telegram`,
    });
  } catch (error) {
    return renderErrorResponse(error);
  }
}

function renderErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(`Assistant error: ${message}`, {
    status: 500,
    headers: {"content-type": "text/plain; charset=utf-8"},
  });
}
