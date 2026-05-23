import { Bot } from 'grammy';
import { chat, isLocalJokeModeActive, matchesFallbackTrigger, roast } from '../ai.js';
import { addSubscriber, removeSubscriber } from '../subscribers.js';

export function setupTelegramHandlers(bot: Bot) {
  // Optional debugging: set DEBUG_LOG_UPDATES=true to log every incoming update
  if (process.env.DEBUG_LOG_UPDATES === 'true') {
    bot.use(async (ctx, next) => {
      try {
        console.log('Incoming update:', JSON.stringify(ctx.update, null, 2));
      } catch (e) {
        // ignore
      }
      await next();
    });
  }

  bot.command('start', async (ctx) => {
    await ctx.reply('OctoBot tayyor. Octopos kodini ko‘rib chiqishga va biroz hazil qilishga shayman. 🔥');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '*OctoBot Commands*',
        '',
          '*OctoBot buyruqlari*',
        '\\- `/roast` \\(reply to code\\) \\- Get a brutal code review',
          '\- Meni tag qiling yoki xabarimga reply qiling',
          '\- `/roast` \(kodga reply qiling\) \- Qiziqarli va foydali roast',
          '\- `/help` \- Shu yordam xabarini ko‘rsatadi',
    );
  });

  bot.command('roast', async (ctx) => {
    const reply = ctx.message?.reply_to_message;
    if (!reply?.text) {
      await ctx.reply('Kod blokiga yoki xabarga reply qilib `/roast` yozing, men uni roast qilaman!', { parse_mode: 'MarkdownV2' });
      return;
    }

    await ctx.reply('🔥 Kuting, OctoBot tirnoqlarini charxlayapti...');
    const result = await roast(reply.text);
    await ctx.reply(result);
  });

  bot.on('message:text', async (ctx) => {
    const botId = ctx.me.id;
    const text = ctx.message.text ?? '';
    const isMentioned = text.includes(`@${ctx.me.username}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === botId;
    const isKeywordTriggered = isLocalJokeModeActive() && matchesFallbackTrigger(text);

    if (!isMentioned && !isReplyToBot && !isKeywordTriggered) return;

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
        await ctx.api.sendMessage(chatId, 'OctoBot bu chatga ulandi. Endi GitHub bildirishnomalari va kodli suhbatlar shu yerda ishlaydi. Meni tag qilib ko‘ring!', { link_preview_options: { is_disabled: true } });
      }

      if (newStatus === 'left' || newStatus === 'kicked') {
        removeSubscriber(chatId);
      }
    } catch (err) {
      console.error('my_chat_member handler error:', err);
    }
  });
}
