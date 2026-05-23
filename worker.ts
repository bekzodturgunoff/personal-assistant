import { webhookCallback } from 'grammy/web';
import { createBot } from './src/bot.js';
import { config } from './src/config.js';
import { getSubscribers } from './src/subscribers.js';
import { setRuntimeEnv } from './src/runtime-env.js';

type RuntimeBindings = Record<string, unknown>;

let botInstance: ReturnType<typeof createBot> | undefined;
let commandsInitialized = false;

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

  if (target) {
    await bot.api.sendMessage(target, message, { parse_mode: 'MarkdownV2' });
    return;
  }

  const subscribers = await getSubscribers();
  if (subscribers.length === 0) {
    console.warn('No Telegram chat configured and no subscribers found — skipping send');
    return;
  }

  for (const id of subscribers) {
    try {
      await bot.api.sendMessage(id, message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('Failed to send to subscriber', id, error);
    }
  }
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

export default {
  async fetch(request: Request, env: RuntimeBindings): Promise<Response> {
    setRuntimeEnv(env);
    const bot = getBot();
    await ensureCommands(bot);
    const url = new URL(request.url);

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
  },
};
