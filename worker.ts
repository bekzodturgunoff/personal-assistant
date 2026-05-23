import { webhookCallback } from 'grammy/web';
import { createBot } from './src/bot.js';
import { config } from './src/config.js';
import { setRuntimeEnv } from './src/runtime-env.js';

type RuntimeBindings = Record<string, unknown>;

let botInstance: ReturnType<typeof createBot> | undefined;
let commandsInitialized = false;
let telegramWebhookInitialized = false;

function getBot(): ReturnType<typeof createBot> {
  if (!botInstance) {
    botInstance = createBot();
  }
  return botInstance;
}

async function ensureCommands(bot: ReturnType<typeof createBot>): Promise<void> {
  if (commandsInitialized) return;

  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start OctoBot' },
      { command: 'help', description: 'Show help' },
      { command: 'roast', description: 'Roast replied code' },
    ]);
    commandsInitialized = true;
  } catch (error) {
    console.warn('Failed to set bot commands in Cloudflare Worker (non-fatal):', error);
  }
}

async function ensureTelegramWebhook(bot: ReturnType<typeof createBot>, origin: string): Promise<void> {
  if (telegramWebhookInitialized) return;

  const webhookUrl = `${origin.replace(/\/+$/, '')}/api/webhooks/telegram`;

  try {
    await bot.api.setWebhook(webhookUrl, {
      drop_pending_updates: true,
    });
    telegramWebhookInitialized = true;
    console.log(`Telegram webhook set to ${webhookUrl}`);
  } catch (error) {
    console.warn('Failed to set Telegram webhook:', error);
  }
}

function tgEscape(text: string): string {
  return text.replace(/[_*[\\]()~`>#+\-=|{}.!]/g, '\\$&');
}

const CATCHPHRASES = [
  'Time to check for console\\.log\\(s\\) before merging\\!',
  'Remember: real developers ship on Fridays\\. Right?',
  'Another PR, another opportunity for merge conflicts\\!',
  'Someone\'s been busy breaking the build\\. Let\'s see\\.',
  'Fresh code smell\\. Let\'s air this room out\\.',
] as const;

async function sendToGroup(message: string): Promise<void> {
  const bot = getBot();
  const target = config.telegramChatId || undefined;

  if (!target) {
    console.warn('TELEGRAM_CHAT_ID is not configured — skipping GitHub notification');
    return;
  }

  await bot.api.sendMessage(target, message, { parse_mode: 'MarkdownV2' });
}

async function verifyGitHubSignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return expected.length === signature.length && expected === signature;
}

async function handleGitHubWebhook(request: Request): Promise<Response> {
  const event = request.headers.get('x-github-event') ?? '';
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  const rawBody = await request.text();

  if (!event || !rawBody) {
    return Response.json({ error: 'Missing event or body' }, { status: 400 });
  }

  if (config.githubWebhookSecret) {
    if (!signature) {
      return Response.json({ error: 'Missing signature' }, { status: 401 });
    }

    const valid = await verifyGitHubSignature(config.githubWebhookSecret, rawBody, signature);
    if (!valid) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const bot = getBot();

    const repo = payload.repository as Record<string, unknown> | undefined;
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    const review = payload.review as Record<string, unknown> | undefined;

    if (!repo || !pr) {
      return Response.json({ ok: true });
    }

    const repoName = tgEscape(repo.full_name as string);
    const title = tgEscape(pr.title as string);
    const author = tgEscape((pr.user as Record<string, unknown>).login as string);
    const url = pr.html_url as string;

    if (event === 'pull_request') {
      const action = payload.action as string;
      const base = tgEscape((pr.base as Record<string, unknown>).ref as string);
      const head = tgEscape((pr.head as Record<string, unknown>).ref as string);

      if (action === 'opened') {
        const lines = [
          `🔀 *New PR:* [${title}](${url})`,
          `📦 *Repo:* ${repoName}`,
          `👤 *Author:* ${author}`,
          `🌿 *Branches:* \`${base}\` → \`${head}\``,
          '',
          `_👾 OctoBot says:_ ${CATCHPHRASES[Math.floor(Math.random() * CATCHPHRASES.length)]}`,
        ];
        await sendToGroup(lines.join('\n'));
      } else if (action === 'closed') {
        const lines = pr.merged
          ? [
              `✅ *PR Merged:* [${title}](${url})`,
              `📦 *Repo:* ${repoName}`,
              `👤 *Author:* ${author}`,
              `🌿 \`${base}\` → \`${head}\``,
              '',
              '_👾 OctoBot says:_ Clean merge\\! The git gods are pleased\\.',
            ]
          : [
              `❌ *PR Closed \(without merge\):* [${title}](${url})`,
              `📦 *Repo:* ${repoName}`,
              `👤 *Author:* ${author}`,
              '',
              "_👾 OctoBot says:_ Abandoned PR\\. We've all been there\\.",
            ];
        await sendToGroup(lines.join('\n'));
      }
    } else if (event === 'pull_request_review' && review) {
      const reviewer = tgEscape((review.user as Record<string, unknown>).login as string);
      const state = review.state as string;

      if (state === 'approved') {
        const lines = [
          `✅ *PR Approved:* [${title}](${url})`,
          `📦 *Repo:* ${repoName}`,
          `👤 *Reviewer:* ${reviewer}`,
          '',
          '_👾 OctoBot says:_ Ship it\\! 🚀',
        ];
        await sendToGroup(lines.join('\n'));
      } else if (state === 'changes_requested') {
        const lines = [
          `🔄 *Changes Requested:* [${title}](${url})`,
          `📦 *Repo:* ${repoName}`,
          `👤 *Reviewer:* ${reviewer}`,
          '',
          "_👾 OctoBot says:_ Back to the keyboard\\! Those tests won't write themselves\\.",
        ];
        await sendToGroup(lines.join('\n'));
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('GitHub webhook handler error:', error);
    return Response.json({ ok: true });
  }
}

function renderHomePage(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OctoBot</title>
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
        <h1>OctoBot</h1>
        <p class="ok">Running on Cloudflare Workers</p>
        <p>This is the bot backend, not a public website.</p>
        <p>Health: <code>/health</code></p>
        <p>Telegram webhook: <code>/api/webhooks/telegram</code></p>
        <p>GitHub webhook: <code>/api/webhooks/github</code></p>
      </div>
    </main>
  </body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function renderErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(`OctoBot error: ${message}`, {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: RuntimeBindings): Promise<Response> {
    try {
      setRuntimeEnv(env);
      const bot = getBot();
      await ensureCommands(bot);
      const url = new URL(request.url);

      await ensureTelegramWebhook(bot, url.origin);

      if (url.pathname === '/' || url.pathname === '') {
        return renderHomePage();
      }

      if (url.pathname === '/health') {
        return Response.json({ ok: true });
      }

      if (url.pathname === '/api/webhooks/telegram' && request.method === 'POST') {
        return webhookCallback(bot, 'cloudflare-mod')(request as Parameters<ReturnType<typeof webhookCallback>>[0]);
      }

      if (url.pathname === '/api/webhooks/github' && request.method === 'POST') {
        return handleGitHubWebhook(request);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Worker fetch error:', error);
      return renderErrorResponse(error);
    }
  },
};
