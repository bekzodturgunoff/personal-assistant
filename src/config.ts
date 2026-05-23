import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  aiApiKey: requireEnv('AI_API_KEY'),
  telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
  port: parseInt(process.env.PORT || '3000', 10),
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
};
