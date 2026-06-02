import type {Bot, Context} from "grammy/web";
import type {ReplyContext as BusinessReplyCtx} from "../../prompts/business.js";
import {businessAssistantReply} from "../../prompts/business.js";
import {classifyIntent} from "../../lib/intent-classifier.js";
import {evaluateConfidence} from "../../lib/confidence-scorer.js";
import {getWeeklyAccumulator, saveWeeklyAccumulator, updateUserMeta} from "../../memory/index.js";
import {addMessage, getRecentHistory} from "../../conversation-memory.js";
import {recordMessage, getPersona} from "../../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../../long-term-memory.js";
import {isChatMuted} from "../../lib/chat-state.js";
import {getConversationSummary, runBrainAnalysis} from "../../brain/brain.js";
import {handleTaskCommand} from "../tasks/index.js";

const fallbacks = [
  "Hozir bandman, keyinroq javob beraman",
  "Sal gaplashamiz keyin, hozir ish bilan bandman",
  "Keyinroq yozaman, hozir biroz band",
  "Hozir qo'lim tegmayapti, keyin albatta javob beraman",
  "Hozir boshqa ish bilan bandman, keyin yozaman",
];

const lastDmTime = new Map<number, number>();

export function setupDmHandler(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (ctx.chat.type !== "private") return;

    const now = Date.now();
    const lastTime = lastDmTime.get(ctx.chat.id) ?? 0;
    if (now - lastTime < 500) {
      console.log(`[Router] DM: rate limited (${ctx.from.first_name || "?"}), ignoring`);
      return;
    }
    lastDmTime.set(ctx.chat.id, now);

    const text = ctx.message.text ?? "";
    if (!text.trim()) return;

    console.log(`[Router] → DM handler: "${text.slice(0, 80)}" from ${ctx.from.first_name || ctx.from.username || "?"}`);

    const chatId = ctx.chat.id;

    if (await isChatMuted(chatId)) {
      console.log(`[Router] DM: chat ${chatId} is muted, skipping`);
      return;
    }

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
      const persona = await getPersona(chatId);
      const longTermBlock = await getFactsBlock(chatId);
      const summary = await getConversationSummary(chatId);

      const intent = classifyIntent(text);
      const topFacts = longTermBlock
        .replace(/^What I know about this person:\n- /, "")
        .split("\n- ")
        .filter(Boolean)
        .slice(0, 5);

      const replyCtx: BusinessReplyCtx = {
        contactName: senderName,
        daysKnown: persona.firstContactDate ? Math.floor((Date.now() - persona.firstContactDate) / 86400000) : 0,
        messageCount: persona.messageCount,
        relationshipStage: persona.relationshipStage,
        brainSummary: summary,
        topFacts,
        sentiment: "neutral",
        intent: intent.isPriceInquiry ? "price_inquiry" : intent.isComplaint ? "complaint" : intent.isGreeting ? "greeting" : "other",
        urgency: intent.estimatedUrgency,
        detectedLanguage: intent.detectedLanguage,
        pendingQuestions: [],
      };

      const enhanced = await (await import("../search.js")).enhanceWithSearch(text);
      const geminiResponse = await businessAssistantReply(enhanced, history, replyCtx);

      const confidenceCheck = await evaluateConfidence(geminiResponse);
      const responseText = confidenceCheck.shouldFallback ? confidenceCheck.fallbackPhrase : geminiResponse.text;

      if (!responseText) {
        console.log(`[Router] DM: empty response, skipping reply`);
        return;
      }

      await addMessage(chatId, "assistant", responseText);
      await recordMessage(chatId, "assistant", responseText);
      await extractAndStoreFact(chatId, text, responseText);

      await ctx.reply(responseText, {link_preview_options: {is_disabled: true}});

      runBrainAnalysis(chatId, senderName).catch((err) =>
        console.error(`[Router] Brain analysis error:`, err),
      );
    } catch (error) {
      console.error(`[Router] DM AI error for ${senderName} (${chatId}):`, error);
      await ctx.reply(fallbacks[Math.floor(Math.random() * fallbacks.length)], {link_preview_options: {is_disabled: true}});
    }
  });
}
