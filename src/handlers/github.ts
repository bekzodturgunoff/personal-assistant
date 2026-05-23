import { Request, Response } from 'express';
import crypto from 'crypto';
import { bot } from '../bot.js';
import { config } from '../config.js';
import { getSubscribers } from '../subscribers.js';

function tgEscape(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

const CATCHPHRASES = [
  "Time to check for console\\.log\\(s\\) before merging\\!",
  "Remember: real developers ship on Fridays\\. Right?",
  "Another PR, another opportunity for merge conflicts\\!",
  "Someone's been busy breaking the build\\. Let's see\\.",
  "Fresh code smell\\. Let's air this room out\\.",
] as const;

async function sendToGroup(message: string) {
  try {
    const target = config.telegramChatId || undefined;
    if (target) {
      await bot.api.sendMessage(target, message, { parse_mode: 'MarkdownV2' });
      return;
    }

    // No fixed chat configured — send to all subscribed chats
    const subs = getSubscribers();
    if (!subs || subs.length === 0) {
      console.warn('No Telegram chat configured and no subscribers found — skipping send');
      return;
    }

    for (const id of subs) {
      try {
        await bot.api.sendMessage(id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        console.error('Failed to send to subscriber', id, err);
      }
    }
  } catch (err) {
    console.error('MarkdownV2 send failed, falling back to plain text:', err);
    try {
      const target = config.telegramChatId || undefined;
      if (target) {
        await bot.api.sendMessage(target, message);
        return;
      }
      const subs = getSubscribers();
      for (const id of subs) {
        try {
          await bot.api.sendMessage(id, message);
        } catch (e) {
          console.error('Fallback send failed for subscriber', id, e);
        }
      }
    } catch (fallbackErr) {
      console.error('Fallback send also failed:', fallbackErr);
    }
  }
}

function handlePullRequest(payload: Record<string, unknown>) {
  const action = payload.action as string;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  if (!pr || !repo) return;

  const repoName = tgEscape(repo.full_name as string);
  const title = tgEscape(pr.title as string);
  const author = tgEscape((pr.user as Record<string, unknown>).login as string);
  const base = tgEscape((pr.base as Record<string, unknown>).ref as string);
  const head = tgEscape((pr.head as Record<string, unknown>).ref as string);
  const url = pr.html_url as string;

  if (action === 'opened') {
    const lines = [
      `🔀 *New PR:* [${title}](${url})`,
      `📦 *Repo:* ${repoName}`,
      `👤 *Author:* ${author}`,
      `🌿 *Branches:* \`${base}\` → \`${head}\``,
    ];
    if (typeof pr.changed_files === 'number') {
      lines.push(`📁 *Files changed:* ${pr.changed_files}`);
    }
    lines.push(
      '',
      `_👾 OctoBot says:_ ${CATCHPHRASES[Math.floor(Math.random() * CATCHPHRASES.length)]}`,
    );
    return sendToGroup(lines.join('\n'));
  }

  if (action === 'closed') {
    if (pr.merged) {
      const lines = [
        `✅ *PR Merged:* [${title}](${url})`,
        `📦 *Repo:* ${repoName}`,
        `👤 *Author:* ${author}`,
        `🌿 \`${base}\` → \`${head}\``,
        '',
        '_👾 OctoBot says:_ Clean merge\\! The git gods are pleased\\.',
      ];
      return sendToGroup(lines.join('\n'));
    } else {
      const lines = [
        `❌ *PR Closed \\(without merge\\):* [${title}](${url})`,
        `📦 *Repo:* ${repoName}`,
        `👤 *Author:* ${author}`,
        '',
        "_👾 OctoBot says:_ Abandoned PR\\. We've all been there\\.  ",
      ];
      return sendToGroup(lines.join('\n'));
    }
  }
}

function handlePullRequestReview(payload: Record<string, unknown>) {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const review = payload.review as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  if (!pr || !review || !repo) return;

  const repoName = tgEscape(repo.full_name as string);
  const title = tgEscape(pr.title as string);
  const reviewer = tgEscape((review.user as Record<string, unknown>).login as string);
  const url = pr.html_url as string;

  const state = review.state as string;

  if (state === 'approved') {
    const lines = [
      `✅ *PR Approved:* [${title}](${url})`,
      `📦 *Repo:* ${repoName}`,
      `👤 *Reviewer:* ${reviewer}`,
      '',
      '_👾 OctoBot says:_ Ship it\\! 🚀',
    ];
    return sendToGroup(lines.join('\n'));
  }

  if (state === 'changes_requested') {
    const lines = [
      `🔄 *Changes Requested:* [${title}](${url})`,
      `📦 *Repo:* ${repoName}`,
      `👤 *Reviewer:* ${reviewer}`,
      '',
      "_👾 OctoBot says:_ Back to the keyboard\\! Those tests won't write themselves\\.  ",
    ];
    return sendToGroup(lines.join('\n'));
  }
}

export async function handleGitHubWebhook(req: Request, res: Response) {
  const rawBody = (req.body as Buffer).toString('utf8');
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string | undefined;

  if (!event || !rawBody) {
    res.status(400).json({ error: 'Missing event or body' });
    return;
  }

  if (config.githubWebhookSecret) {
    if (!signature) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
    const expected = `sha256=${hmac.update(rawBody).digest('hex')}`;
    if (expected.length !== signature.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (event === 'pull_request' && payload.pull_request) {
      await handlePullRequest(payload);
    } else if (event === 'pull_request_review' && payload.pull_request && payload.review) {
      await handlePullRequestReview(payload);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('GitHub webhook handler error:', err);
    res.status(200).json({ ok: true });
  }
}
