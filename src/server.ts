import dotenv from 'dotenv';
import express from 'express';
import { webhookCallback } from 'grammy/web';
import { createBot } from './bot.js';
import { config } from './config.js';
import { createGitHubWebhookHandler } from './handlers/github.js';

dotenv.config();

const bot = createBot();

const app = express();

app.post('/api/webhooks/github', express.raw({ type: 'application/json' }), createGitHubWebhookHandler(bot));

app.get('/health', (_req, res) => res.json({ ok: true }));

async function main() {
  const webhookUrl = process.env.WEBHOOK_URL;
  // Register bot commands so they show up in Telegram clients
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Start OctoBot' },
      { command: 'help', description: 'Show help' },
      { command: 'roast', description: 'Roast replied code' },
      { command: 'stop', description: 'Mute OctoBot in this chat' },
      { command: 'resume', description: 'Re-enable OctoBot in this chat' },
    ]);
  } catch (err) {
    console.warn('Failed to set bot commands (non-fatal):', err);
  }

  if (webhookUrl) {
    try {
      const whUrl = `${webhookUrl.replace(/\/+$/, '')}/api/webhooks/telegram`;
      await bot.api.setWebhook(whUrl);
      app.post('/api/webhooks/telegram', webhookCallback(bot, 'express'));
      console.log(`Bot webhook set to ${whUrl}`);
    } catch (err) {
      console.error('Failed to set webhook, falling back to polling:', err);
      bot.start();
    }
  } else {
    bot.start({ drop_pending_updates: true });
    console.log('Bot started in polling mode — no WEBHOOK_URL set');
  }

  app.listen(config.port, () => {
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
