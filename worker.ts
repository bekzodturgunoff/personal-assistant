import {webhookCallback} from "grammy/web";
import {createBot} from "./src/bot.js";
import {config} from "./src/config.js";
import {setRuntimeEnv} from "./src/runtime-env.js";
import {setKvBinding} from "./src/conversation-memory.js";
import {setKvBinding as setPersonaKv} from "./src/persona-memory.js";
import {setConversationsKv, setTasksKv, setLongTermKv, setModelCooldownKv} from "./src/lib/kv-store.js";
import {handleMorningBriefing, checkDueTasks} from "./src/handlers/tasks.js";

type RuntimeBindings = Record<string, unknown>;

let botInstance: ReturnType<typeof createBot> | undefined;
let commandsInitialized = false;

function getBot(): ReturnType<typeof createBot> {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

async function ensureCommands(
  bot: ReturnType<typeof createBot>,
): Promise<void> {
  if (commandsInitialized) return;

  const commands = [
    {command: "start", description: "Start the bot"},
    {command: "help", description: "Show help"},
    {command: "tasks", description: "Show your tasks"},
    {command: "remind", description: "Set a reminder"},
    {command: "done", description: "Mark a task as done"},
  ] as const;

  try {
    await Promise.all([
      bot.api.setMyCommands(commands),
      bot.api.setMyCommands(commands, {scope: {type: "all_private_chats"}}),
      bot.api.setMyCommands(commands, {scope: {type: "all_group_chats"}}),
    ]);
    commandsInitialized = true;
  } catch (error) {
    console.warn(
      "Failed to set bot commands in Cloudflare Worker (non-fatal):",
      error,
    );
  }
}

async function ensureTelegramWebhook(
  bot: ReturnType<typeof createBot>,
  origin: string,
): Promise<void> {
  const webhookUrl = `${origin.replace(/\/+$/, "")}/api/webhooks/telegram`;

  try {
    await bot.api.setWebhook(webhookUrl, {
      drop_pending_updates: true,
    });
    console.log(`Telegram webhook set to ${webhookUrl}`);
  } catch (error) {
    console.warn("Failed to set Telegram webhook:", error);
  }
}

async function getTelegramDebugInfo(
  bot: ReturnType<typeof createBot>,
  origin: string,
): Promise<Response> {
  try {
    const [me, webhookInfo] = await Promise.all([
      bot.api.getMe(),
      bot.api.getWebhookInfo(),
    ]);

    return Response.json({
      ok: true,
      bot: {
        id: me.id,
        username: me.username,
        first_name: me.first_name,
      },
      webhook: webhookInfo,
      expectedWebhookUrl: `${origin.replace(/\/+$/, "")}/api/webhooks/telegram`,
    });
  } catch (error) {
    return renderErrorResponse(error);
  }
}

// GitHub webhook handler removed — OctoBot is now a personal assistant only

function renderHomePage(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bekzod's Assistant</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
      main { max-width: 640px; padding: 32px; text-align: center; }
      .card { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 20px; padding: 32px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
      h1 { margin: 0 0 12px; font-size: 2.5rem; }
      p { margin: 0.5rem 0; line-height: 1.6; color: #cbd5e1; }
      code { background: rgba(148, 163, 184, 0.16); padding: 0.2rem 0.45rem; border-radius: 8px; }
      .ok { color: #4ade80; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Bekzod's Assistant</h1>
        <p class="ok">Running on Cloudflare Workers</p>
        <p>This is the bot backend, not a public website.</p>
        <p>Health: <code>/health</code></p>
        <p>Telegram webhook: <code>/api/webhooks/telegram</code></p>
      </div>
    </main>
  </body>
</html>`;

  return new Response(html, {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
}

function renderErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(`Assistant error: ${message}`, {
    status: 500,
    headers: {"content-type": "text/plain; charset=utf-8"},
  });
}

export default {
  async scheduled(_event: unknown, env: RuntimeBindings): Promise<void> {
    setRuntimeEnv(env);
    const conversations = (env as Record<string, unknown>).CONVERSATIONS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
    const tasks = (env as Record<string, unknown>).TASKS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
    const longTerm = (env as Record<string, unknown>).LONG_TERM_MEMORY as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
    if (conversations) { setKvBinding(conversations); setPersonaKv(conversations); setConversationsKv(conversations); setModelCooldownKv(conversations); }
    if (tasks) setTasksKv(tasks);
    if (longTerm) setLongTermKv(longTerm);
    await checkDueTasks();
    await handleMorningBriefing();
  },

  async fetch(request: Request, env: RuntimeBindings): Promise<Response> {
    try {
      setRuntimeEnv(env);
      const conversations = (env as Record<string, unknown>).CONVERSATIONS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
      const tasks = (env as Record<string, unknown>).TASKS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
      const longTerm = (env as Record<string, unknown>).LONG_TERM_MEMORY as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
      if (conversations) {
        setKvBinding(conversations);
        setPersonaKv(conversations);
        setConversationsKv(conversations);
        setModelCooldownKv(conversations);
      }
      if (tasks) setTasksKv(tasks);
      if (longTerm) setLongTermKv(longTerm);
      const bot = getBot();
      await ensureCommands(bot);
      const url = new URL(request.url);

      if (url.pathname === '/' || url.pathname === '') {
        await ensureTelegramWebhook(bot, url.origin);
        return renderHomePage();
      }

      if (url.pathname === '/setup') {
        await ensureTelegramWebhook(bot, url.origin);
        return Response.json({ ok: true, message: 'Telegram webhook registered' });
      }

      if (url.pathname === '/health') {
        return Response.json({ ok: true });
      }

      if (url.pathname === '/debug/telegram') {
        return getTelegramDebugInfo(bot, url.origin);
      }

      if (url.pathname === '/api/webhooks/telegram' && request.method === 'POST') {
        return webhookCallback(bot, 'cloudflare-mod', { timeoutMilliseconds: 25000 })(request, env);
      }

      // Direct API test - send a test message (used for debugging)
      if (url.pathname === '/debug/send' && request.method === 'POST') {
        try {
          const body = await request.json() as { chat_id?: number; text?: string };
          if (!body.chat_id) {
            return Response.json({ error: 'chat_id is required' }, { status: 400 });
          }
          const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: body.chat_id, text: body.text || 'test' }),
          });
          const data = await res.json();
          console.log('Raw send result:', JSON.stringify(data));
          return Response.json(data);
        } catch (error) {
          console.error('Raw send error:', error);
          return Response.json({ error: String(error) }, { status: 500 });
        }
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Worker fetch error:', error);
      return renderErrorResponse(error);
    }
  },
};
