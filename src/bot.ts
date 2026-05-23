import { Bot } from 'grammy/web';
import { config } from './config.js';
import { setupTelegramHandlers } from './handlers/telegram.js';

export function createBot() {
  const bot = new Bot(config.telegramBotToken);

  setupTelegramHandlers(bot);

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}
