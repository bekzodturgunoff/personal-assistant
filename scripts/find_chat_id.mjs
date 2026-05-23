#!/usr/bin/env node
// Helper: fetch Telegram webhook info and getUpdates to find chat IDs
// Usage: TELEGRAM_BOT_TOKEN=xxx node scripts/find_chat_id.mjs
import process from 'process';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in env. Run: TELEGRAM_BOT_TOKEN=xxx node scripts/find_chat_id.mjs');
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;
async function fetchJson(path) {
  const res = await fetch(`${base}/${path}`);
  return res.json();
}

(async () => {
  try {
    console.log('Fetching webhook info...');
    const webhook = await fetchJson('getWebhookInfo');
    console.log(JSON.stringify(webhook, null, 2));

    console.log('\nFetching getUpdates (may be empty if webhook is set)...');
    const updates = await fetchJson('getUpdates');
    console.log(JSON.stringify(updates, null, 2));

    console.log('\nFind a `chat.id` in the printed JSON and copy it into your .env as TELEGRAM_CHAT_ID');
    console.log('\nIf getUpdates is empty but webhook is set, temporarily remove the webhook:');
    console.log('  curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"');
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
})();
