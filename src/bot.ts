import { Bot } from 'grammy';
import { config } from './config.js';
import { setupTelegramHandlers } from './handlers/telegram.js';

export const bot = new Bot(config.telegramBotToken);

setupTelegramHandlers(bot);

bot.catch((err) => {
  console.error('Bot error:', err);
});
