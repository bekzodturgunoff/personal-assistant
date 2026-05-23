import type { Bot } from 'grammy/web';
import { chat, isLocalJokeModeActive, matchesFallbackTrigger, roast } from '../ai.js';
import { getEnv } from '../runtime-env.js';

const mutedChats = new Map<number, { reason: string; mutedAt: number }>();
const lastGroupReplyAt = new Map<number, number>();
const GROUP_REPLY_COOLDOWN_MS = 12_000;
const knownUsers = new Map<string, string>([
  ['azizbek_juraev1', 'Aziz'],
  ['jcbbb', 'Avaz'],
]);

function getDisplayName(username?: string): string | undefined {
  if (!username) return undefined;
  return knownUsers.get(username.toLowerCase());
}

function isChatMuted(chatId: number): boolean {
  return mutedChats.has(chatId);
}

function muteChat(chatId: number, reason: string): void {
  mutedChats.set(chatId, { reason, mutedAt: Date.now() });
}

function unmuteChat(chatId: number): void {
  mutedChats.delete(chatId);
}

function canReplyInGroup(chatId: number): boolean {
  const now = Date.now();
  const lastReplyAt = lastGroupReplyAt.get(chatId) ?? 0;
  if (now - lastReplyAt < GROUP_REPLY_COOLDOWN_MS) {
    return false;
  }

  lastGroupReplyAt.set(chatId, now);
  return true;
}

function isStopRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(?:stop|mute|quiet|shut up|be quiet|don't message|do not message|dont message|stop messaging|don't text|do not text|dont text)/i.test(lower) ||
    /(?:jim bo'?l|gapirma|yozma|jim tur|tinch tur|sukut)/i.test(lower)
  );
}

function isResumeRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(?:resume|unmute|start talking|talk again|wake up|unpause|re-enable)/i.test(lower) ||
    /(?:qayta gapir|yana yoz|yozishni boshl|och|faollashtir)/i.test(lower)
  );
}

function isDirectBotAddress(text: string, username: string | undefined): boolean {
  const lower = text.toLowerCase();
  const normalizedName = (username ?? '').toLowerCase();
  return lower.includes(`@${normalizedName}`) || /\boctobot\b|\bocto bot\b|\bbot\b/i.test(lower);
}

function scoreGroupMessage(text: string): number {
  const lower = text.toLowerCase();
  const compact = lower.trim();

  if (!compact || compact.startsWith('/')) return -100;

  let score = 0;

  if (/\?/.test(text)) score += 2;

  if (/^(why|what|how|when|where|who|which|help|please|can you|could you|would you|should i|is it|does it|do you|explain|review|fix|debug|roast|suggest|check|look at|what do you think)\b/i.test(compact)) {
    score += 2;
  }

  if (/\b(code|bug|error|issue|deploy|merge|conflict|test|refactor|ai|prompt|model|bot|telegram|github|worker|cloudflare|typescript|react|node|api|build|commit|branch|ci|pipeline)\b/i.test(compact)) {
    score += 2;
  }

  if (/```|`[^`]+`|\bfunction\b|\bconst\b|\bclass\b|\breturn\b|[{}();]/.test(text)) {
    score += 2;
  }

  if (/^(hi|hello|hey|salom|assalomu alaykum|yoo|bro|team|assalomu)\b/i.test(compact)) {
    score += 1;
  }

  if (/\b(thanks|thank you|pls|please|ok|okay|cool|nice|lol|haha)\b/i.test(compact)) {
    score += 1;
  }

  if (compact.length > 20 && compact.length < 220 && /\b(should|could|would|can|may|might|need to|want to|let's|lets)\b/i.test(compact)) {
    score += 1;
  }

  if (compact.length > 160 && score < 2) {
    score -= 1;
  }

  return score;
}

function shouldAutoRespondInGroup(text: string): boolean {
  const score = scoreGroupMessage(text);
  return score >= 2;
}

function shouldReplyToMessage(params: {
  text: string;
  chatType?: string;
  isMentioned: boolean;
  isReplyToBot: boolean;
  isKeywordTriggered: boolean;
  username?: string;
}): boolean {
  const { text, chatType, isMentioned, isReplyToBot, isKeywordTriggered, username } = params;

  if (isMentioned || isReplyToBot || isKeywordTriggered) {
    return true;
  }

  if (chatType === 'private') {
    return text.trim().length > 0;
  }

  if (chatType === 'group' || chatType === 'supergroup') {
    return isDirectBotAddress(text, username) || shouldAutoRespondInGroup(text);
  }

  return false;
}

function isPrivateCommandLike(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === '/start' || lower === '/help' || lower === '/roast' || lower === '/stop' || lower === '/mute' || lower === '/resume' || lower === '/unmute' || lower === '/quiet';
}

function getCommandName(text: string): string | undefined {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase();
}

type CommandContextLike = ReplyContext & {
  chat?: { id: number; type: 'private' | 'group' | 'supergroup' | string };
  from?: { username?: string };
  me: { username?: string };
  message?: { text?: string; reply_to_message?: { text?: string; from?: { id?: number } } };
};

async function handleCommandFallback(ctx: CommandContextLike, text: string): Promise<boolean> {
  const command = getCommandName(text);
  if (!command) return false;

  const displayName = getDisplayName(ctx.from?.username);
  const greeting = displayName ? `${displayName}, ` : '';

  if (command === 'start') {
    await replySafe(ctx, `${greeting}Octopos Agent tayyor. Men kodni ko‘rib chiqaman, savollarga javob beraman va kerak bo‘lsa hazil ham qilaman. 🔥`);
    return true;
  }

  if (command === 'help') {
    await replySafe(
      ctx,
      [
        'Octopos Agent buyruqlari:',
        '- /start — botni ishga tushirish',
        '- /help — yordam',
        '- /roast — reply qilingan kodni roast qilish',
        '- /stop yoki /mute — shu chatda jim turish',
        '- /resume yoki /unmute — qayta javob berishni yoqish',
        '',
        'Men odatda faqat menga murojaat qilinganda, reply qilinganda yoki savol/texnik so‘rov bo‘lganda javob beraman.',
      ].join('\n'),
    );
    return true;
  }

  if (command === 'stop' || command === 'mute' || command === 'quiet') {
    if (ctx.chat) {
      muteChat(ctx.chat.id, 'command');
    }
    await replySafe(ctx, 'Tushunarli. Bu chatda jim turaman. Qayta yoqish uchun /resume yozing.');
    return true;
  }

  if (command === 'resume' || command === 'unmute') {
    if (ctx.chat) {
      unmuteChat(ctx.chat.id);
    }
    await replySafe(ctx, 'Yoqildi. Endi yana javob beraman.');
    return true;
  }

  if (command === 'roast') {
    const reply = ctx.message?.reply_to_message;
    if (!reply?.text) {
      await replySafe(ctx, 'Kod blokiga yoki xabarga reply qilib /roast yozing, men uni roast qilaman!');
      return true;
    }

    await replySafe(ctx, '🔥 Kuting, Octopos Agent tekshiryapti...');
    const result = await roast(reply.text);
    await ctx.reply(result);
    return true;
  }

  return false;
}

type ReplyContext = {
  reply: (text: string) => Promise<unknown>;
};

async function replySafe(ctx: ReplyContext, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (error) {
    console.warn('Plain reply failed:', error);
  }
}

export function setupTelegramHandlers(bot: Bot) {
  // Optional debugging: set DEBUG_LOG_UPDATES=true to log every incoming update
  if (getEnv('DEBUG_LOG_UPDATES') === 'true') {
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
    const displayName = getDisplayName(ctx.from?.username);
    const greeting = displayName ? `${displayName}, ` : '';
    await replySafe(ctx, `${greeting}Octopos Agent tayyor. Men kodni ko‘rib chiqaman, savollarga javob beraman va kerak bo‘lsa hazil ham qilaman. 🔥`);
  });

  bot.command('help', async (ctx) => {
    await replySafe(
      ctx,
      [
        'Octopos Agent buyruqlari:',
        '- /start — botni ishga tushirish',
        '- /help — yordam',
        '- /roast — reply qilingan kodni roast qilish',
        '- /stop yoki /mute — shu chatda jim turish',
        '- /resume yoki /unmute — qayta javob berishni yoqish',
        '',
        'Men odatda faqat menga murojaat qilinganda, reply qilinganda yoki savol/texnik so‘rov bo‘lganda javob beraman.',
      ].join('\n'),
    );
  });

  bot.command(['stop', 'mute', 'quiet'], async (ctx) => {
    if (!ctx.chat) return;
    muteChat(ctx.chat.id, 'command');
    await replySafe(ctx, 'Tushunarli. Bu chatda jim turaman. Qayta yoqish uchun /resume yozing.');
  });

  bot.command(['resume', 'unmute'], async (ctx) => {
    if (!ctx.chat) return;
    unmuteChat(ctx.chat.id);
    await replySafe(ctx, 'Yoqildi. Endi yana javob beraman.');
  });

  bot.command('roast', async (ctx) => {
    const reply = ctx.message?.reply_to_message;
    if (!reply?.text) {
      await replySafe(ctx, 'Kod blokiga yoki xabarga reply qilib /roast yozing, men uni roast qilaman!');
      return;
    }

    await replySafe(ctx, '🔥 Kuting, OctoBot tirnoqlarini charxlayapti...');
    const result = await roast(reply.text);
    await ctx.reply(result);
  });

  bot.on('message:text', async (ctx) => {
    if (!ctx.chat || !ctx.from) return;

    const botId = ctx.me.id;
    const text = ctx.message.text ?? '';
    const displayName = getDisplayName(ctx.from?.username);
    const isMentioned = text.includes(`@${ctx.me.username}`);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === botId;
    const isKeywordTriggered = isLocalJokeModeActive() && matchesFallbackTrigger(text);
    const chatMuted = isChatMuted(ctx.chat.id);

    if (await handleCommandFallback(ctx as CommandContextLike, text)) {
      return;
    }

    const isStop = isStopRequest(text);
    const isResume = isResumeRequest(text);

    if (isStop) {
      muteChat(ctx.chat.id, 'message');
      await replySafe(ctx, 'Tushunarli. Shu chatda jim turaman. Qayta yoqish uchun /resume yozing.');
      return;
    }

    if (isResume) {
      unmuteChat(ctx.chat.id);
      await replySafe(ctx, 'Yaxshi, qayta yoqildim.');
      return;
    }

    if (ctx.chat.type === 'private' && isPrivateCommandLike(text)) {
      if (text === '/start') {
        const displayName = getDisplayName(ctx.from?.username);
        const greeting = displayName ? `${displayName}, ` : '';
        await replySafe(ctx, `${greeting}Octopos Agent tayyor. Men kodni ko‘rib chiqaman, savollarga javob beraman va kerak bo‘lsa hazil ham qilaman. 🔥`);
        return;
      }

      if (text === '/help') {
        await replySafe(
          ctx,
          [
            'Octopos Agent buyruqlari:',
            '- /start — botni ishga tushirish',
            '- /help — yordam',
            '- /roast — reply qilingan kodni roast qilish',
            '- /stop yoki /mute — shu chatda jim turish',
            '- /resume yoki /unmute — qayta javob berishni yoqish',
          ].join('\n'),
        );
        return;
      }
    }

    if (chatMuted && !isMentioned && !isReplyToBot && !isKeywordTriggered) return;

    if ((ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') && !canReplyInGroup(ctx.chat.id)) {
      return;
    }

    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      const groupScore = scoreGroupMessage(text);
      if (!isMentioned && !isReplyToBot && !isKeywordTriggered && groupScore < 2) {
        return;
      }
    }

    const shouldReply = shouldReplyToMessage({
      text,
      chatType: ctx.chat.type,
      isMentioned,
      isReplyToBot,
      isKeywordTriggered,
      username: ctx.me.username,
    });

    if (!shouldReply) return;

    await ctx.replyWithChatAction('typing');
    const response = await chat(text);
    await ctx.reply(displayName ? `${displayName}, ${response}` : response, { link_preview_options: { is_disabled: true } });
  });

}
