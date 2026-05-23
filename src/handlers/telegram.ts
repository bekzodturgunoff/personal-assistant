import { Bot } from 'grammy';
import { chat, roast } from '../ai.js';
import { addSubscriber, removeSubscriber } from '../subscribers.js';

export function setupTelegramHandlers(bot: Bot) {
  bot.command('start', async (ctx) => {
    await ctx.reply('OctoBot online. Ready to judge your code. 🔥');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '*OctoBot Commands*',
        '',
        '\\- Tag me or reply to my messages to chat',
        '\\- `/roast` \\(reply to code\\) \\- Get a brutal code review',
        '\\- `/help` \\- Show this message',
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  bot.command('roast', async (ctx) => {
    const reply = ctx.message?.reply_to_message;
    if (!reply?.text) {
      await ctx.reply('Reply to a code block or message with `/roast` to get it roasted!', { parse_mode: 'MarkdownV2' });
      return;
    }

    await ctx.reply('🔥 Let me sharpen my claws...');
    const result = await roast(reply.text);
    await ctx.reply(result);
  });

  bot.on('message:text', async (ctx) => {
    const botId = ctx.me.id;
    const text = ctx.message.text ?? '';
    const isMentioned = text.includes(`@${ctx.me.username}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === botId;

    if (!isMentioned && !isReplyToBot) return;

    await ctx.replyWithChatAction('typing');
    const response = await chat(text);
    await ctx.reply(response, { link_preview_options: { is_disabled: true } });
  });

  // Auto-subscribe when the bot is added to a chat or removed
  bot.on('my_chat_member', async (ctx) => {
    try {
      const newStatus = ctx.update.my_chat_member?.new_chat_member?.status;
      const chat = ctx.update.my_chat_member?.chat;
      if (!chat || typeof chat.id !== 'number') return;
      const chatId = chat.id as number;

      if (newStatus === 'member' || newStatus === 'administrator') {
        addSubscriber(chatId);
        await ctx.api.sendMessage(chatId, 'OctoBot subscribed to this chat for GitHub notifications and chat commands. Try mentioning me!', { disable_web_page_preview: true });
      }

      if (newStatus === 'left' || newStatus === 'kicked') {
        removeSubscriber(chatId);
      }
    } catch (err) {
      console.error('my_chat_member handler error:', err);
    }
  });
}
