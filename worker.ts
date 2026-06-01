import {webhookCallback} from "grammy/web";
import {createBot, registerPublicCommands} from "./src/bot.js";
import {config} from "./src/config.js";
import {setRuntimeEnv, getEnv} from "./src/runtime-env.js";
import {setKvBinding} from "./src/conversation-memory.js";
import {setKvBinding as setPersonaKv} from "./src/persona-memory.js";
import {setConversationsKv, setTasksKv, setLongTermKv, setModelCooldownKv} from "./src/lib/kv-store.js";
import {setChatStateKv} from "./src/lib/chat-state.js";
import {handleMorningBriefing, handleWeeklyAnalytics, checkDueTasks} from "./src/handlers/tasks.js";
import {processDuePendingReplies} from "./src/handlers/business.js";
import {handleDashboardApi, renderDashboardPage} from "./src/dashboard.js";


type RuntimeBindings = Record<string, unknown>;

let botInstance: ReturnType<typeof createBot> | undefined;

function getBot(): ReturnType<typeof createBot> {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

async function ensureTelegramWebhook(
  bot: ReturnType<typeof createBot>,
  origin: string,
): Promise<void> {
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

// GitHub webhook handler removed — now a personal assistant only

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

function setupKvBindings(env: RuntimeBindings): void {
  const conversations = (env as Record<string, unknown>).CONVERSATIONS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  const tasks = (env as Record<string, unknown>).TASKS as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  const longTerm = (env as Record<string, unknown>).LONG_TERM_MEMORY as {get: (key: string) => Promise<string | null>; put: (key: string, value: string) => Promise<void>} | undefined;
  if (conversations) { setKvBinding(conversations); setPersonaKv(conversations); setConversationsKv(conversations); setModelCooldownKv(conversations); setChatStateKv(conversations); }
  if (tasks) setTasksKv(tasks);
  if (longTerm) setLongTermKv(longTerm);
}

export default {
  async scheduled(event: {cron?: string}, env: RuntimeBindings, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    setRuntimeEnv(env);
    setupKvBindings(env);
    await checkDueTasks();
    await handleMorningBriefing();

    const cron = event.cron ?? "";
    if (cron.includes("0 3 * * 1")) {
      ctx.waitUntil(handleWeeklyAnalytics());
    }

    ctx.waitUntil(processDuePendingReplies());
  },

  async fetch(request: Request, env: RuntimeBindings, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    try {
      setRuntimeEnv(env);
      setupKvBindings(env);
      const bot = getBot();
      await registerPublicCommands(bot);
      const url = new URL(request.url);

      if (url.pathname === '/' || url.pathname === '') {
        await ensureTelegramWebhook(bot, url.origin);
        if (config.dashboardUsername && config.dashboardPassword) {
          return Response.redirect(`${url.origin}/api/dashboard`, 302);
        }
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
        const secretToken = config.webhookSecret;
        if (secretToken && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secretToken) {
          return new Response('Unauthorized', { status: 401 });
        }
        const response = await webhookCallback(bot, 'cloudflare-mod', { timeoutMilliseconds: 25000 })(request, env);
        ctx.waitUntil(processDuePendingReplies());
        return response;
      }

      // ── Dashboard ──
      if (url.pathname.startsWith("/api/dashboard")) {
        const user = config.dashboardUsername;
        const pw = config.dashboardPassword;
        if (!user || !pw) {
          return new Response('Dashboard disabled. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD.', {
            status: 404,
            headers: {"content-type": "text/plain; charset=utf-8"},
          });
        }
        if (url.pathname === "/api/dashboard" || url.pathname === "/api/dashboard/") {
          return renderDashboardPage();
        }
        const auth = request.headers.get("Authorization") || "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token !== `${user}:${pw}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = request.method === "PUT" || request.method === "POST" ? await request.text() : null;
        const result = await handleDashboardApi(url.pathname, request.method, body);
        if (result) return result;
        return new Response("Not found", { status: 404 });
      }

      // Debug endpoints — only when DEBUG_ENABLED=true
      if (getEnv("DEBUG_ENABLED") === "true") {
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
              signal: AbortSignal.timeout(10000),
            });
            const data = await res.json();
            return Response.json(data);
          } catch (error) {
            console.error('Raw send error:', error);
            return Response.json({ error: String(error) }, { status: 500 });
          }
        }

        if (url.pathname === '/debug/telegram') {
          return getTelegramDebugInfo(bot, url.origin);
        }
      }

      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Worker fetch error:', error);
      return renderErrorResponse(error);
    }
  },
};
