import type {Bot, Context} from "grammy/web";
import {
  isBusinessUpdate,
  handleBusinessUpdate,
} from "./business.js";
import {
  registerTaskHandlers,
  handleTaskCommand,
} from "./tasks.js";
import {enhanceWithSearch} from "./search.js";
import {businessAssistantReply} from "../prompts/business.js";
import {addMessage, getRecentHistory} from "../conversation-memory.js";
import {recordMessage, buildPersonaBlock} from "../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../long-term-memory.js";

type ReplyContext = {reply: (text: string, opts?: Record<string, unknown>) => Promise<unknown>};

async function replySafe(ctx: ReplyContext, text: string): Promise<void> {
  try {
    await ctx.reply(text, {link_preview_options: {is_disabled: true}});
  } catch (error) {
    console.error("replySafe: FAILED:", error instanceof Error ? error.message : String(error));
  }
}

export function setupTelegramHandlers(bot: Bot) {
  bot.use(async (ctx, next) => {
    const update = ctx.update as unknown as Record<string, unknown>;
    const hasBusiness = isBusinessUpdate(update);
    console.log(`[Router] msg="${(ctx.message?.text ?? "").slice(0, 60)}" | business=${hasBusiness} | type=${ctx.chat?.type ?? "?"}`);
    if (hasBusiness) {
      console.log(`[Router] → business handler`);
      await handleBusinessUpdate(bot, update);
      return;
    }
    await next();
  });

  registerTaskHandlers(bot);

  bot.command("ping", async (ctx) => {
    const ts = new Date().toISOString();
    console.log(`[Router] → ping handler at ${ts}`);
    await ctx.reply(`ok — business handler active | ${ts}`, {link_preview_options: {is_disabled: true}});
  });

  bot.on("message:text", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (ctx.chat.type !== "private") return;

    const text = ctx.message.text ?? "";
    if (!text.trim()) return;

    console.log(`[Router] → DM handler: "${text.slice(0, 80)}" from ${ctx.from.first_name || ctx.from.username || "?"}`);

    const chatId = ctx.chat.id;
    const senderName = ctx.from.first_name || ctx.from.username || "User";

    const shortText = text.toLowerCase().trim();
    if (/^(ok|lol|ha+)$/.test(shortText)) {
      console.log(`[Router] DM: skipped short/spam message: "${text}"`);
      return;
    }

    if (await handleTaskCommand(ctx as Context, text)) {
      console.log(`[Router] DM: handled as task command`);
      return;
    }

    await ctx.replyWithChatAction("typing");

    try {
      await addMessage(chatId, "user", text);
      await recordMessage(chatId, "user", text);

      const history = await getRecentHistory(chatId);
      const isFirstContact = history.length <= 1;
      const personaBlock = await buildPersonaBlock(chatId);
      const longTermBlock = await getFactsBlock(chatId);
      const fullContext = [personaBlock, longTermBlock].filter(Boolean).join("\n");

      const enhanced = await enhanceWithSearch(text);
      const response = await businessAssistantReply(
        enhanced,
        isFirstContact,
        history,
        senderName,
        fullContext,
      );

      await addMessage(chatId, "assistant", response);
      await recordMessage(chatId, "assistant", response);
      await extractAndStoreFact(chatId, text, response);

      await replySafe(ctx, response);
    } catch (error) {
      console.error(`[Router] DM AI error for ${senderName} (${chatId}):`, error);
      const fallbacks = [
        "Hozir bandman, keyinroq javob beraman",
        "Sal gaplashamiz keyin, hozir ish bilan bandman",
        "Keyinroq yozaman, hozir biroz band",
        "Hozir qo'lim tegmayapti, keyin albatta javob beraman",
        "Hozir boshqa ish bilan bandman, keyin yozaman",
      ];
      await replySafe(ctx, fallbacks[Math.floor(Math.random() * fallbacks.length)]);
    }
  });
}
