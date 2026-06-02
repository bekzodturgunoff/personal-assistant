import type {Bot, Context} from "grammy/web";
import type {ReplyContext as BusinessReplyCtx} from "../../prompts/business.js";
import {businessAssistantReply} from "../../prompts/business.js";
import {classifyIntent} from "../../lib/intent-classifier.js";
import {evaluateConfidence} from "../../lib/confidence-scorer.js";
import {getUserMeta, getWeeklyAccumulator, getLongTermKv} from "../../memory/index.js";
import {getRecentHistory} from "../../conversation-memory.js";
import {getPersona} from "../../persona-memory.js";
import {getFactsBlock} from "../../long-term-memory.js";
import {getConversationSummary, runBrainAnalysis, getBrainOutput} from "../../brain/brain.js";
import {callGeminiWithFallback} from "../../lib/gemini.js";
import {isOwner, getContactName, parseChatId, parseChatIdAndRest, sendBusinessMessage} from "./helpers.js";

export function setupOwnerActionCommands(bot: Bot): void {
  bot.command("test", async (ctx) => {
    if (!isOwner(ctx)) return;
    const {chatId, rest} = parseChatIdAndRest(ctx.message?.text ?? "");
    if (!chatId || !rest) {
      await ctx.reply("Ishlatish: /test [chat_id] [xabar]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const history = await getRecentHistory(chatId);
      const persona = await getPersona(chatId);
      const longTermBlock = await getFactsBlock(chatId);
      const summary = await getConversationSummary(chatId);
      const intent = classifyIntent(rest);
      const topFacts = longTermBlock
        .replace(/^What I know about this person:\n- /, "")
        .split("\n- ")
        .filter(Boolean)
        .slice(0, 5);
      const replyCtx: BusinessReplyCtx = {
        contactName: String(chatId),
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
      const geminiResponse = await businessAssistantReply(rest, history, replyCtx);
      const confidenceCheck = await evaluateConfidence(geminiResponse);
      const responseText = confidenceCheck.shouldFallback ? confidenceCheck.fallbackPhrase : geminiResponse.text;
      await ctx.reply(
        `🧪 Test sonuci — ${chatId}\n─────────────────────────\n💬 Siz: "${rest}"\n🤖 Bot: "${responseText}"\n📊 Ishonch: ${geminiResponse.confidence}\n🌐 Til: ${intent.detectedLanguage}\n⚡ Shoshilinch: ${intent.estimatedUrgency}`,
        {link_preview_options: {is_disabled: true}},
      );
    } catch (e) {
      console.error("[Test] Error:", e);
      await ctx.reply("Test bajarilmadi. Chat ID ni tekshiring.", {link_preview_options: {is_disabled: true}});
    }
  });

  bot.command("reply", async (ctx) => {
    if (!isOwner(ctx)) return;
    const {chatId, rest} = parseChatIdAndRest(ctx.message?.text ?? "");
    if (!chatId || !rest) {
      await ctx.reply("Ishlatish: /reply [chat_id] [matn]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const meta = await getUserMeta(String(chatId));
      if (!meta.businessConnectionId) {
        await ctx.reply("❌ Bu chat ID topilmadi. Avval ular siz bilan gaplashishi kerak.", {link_preview_options: {is_disabled: true}});
        return;
      }
      const ok = await sendBusinessMessage(meta.businessConnectionId, chatId, rest);
      if (ok) {
        await ctx.reply("✅ Yuborildi.", {link_preview_options: {is_disabled: true}});
      } else {
        await ctx.reply("❌ Yuborishda xatolik.", {link_preview_options: {is_disabled: true}});
      }
    } catch (e) {
      console.error("[Reply] Error:", e);
    }
  });

  bot.command("summarize", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /summarize [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      await runBrainAnalysis(chatId, "Admin", true);
      const brainOut = await getBrainOutput(chatId);
      if (!brainOut) {
        await ctx.reply("Xulosa tayyorlanmadi.", {link_preview_options: {is_disabled: true}});
        return;
      }
      await ctx.reply(
        `📋 Xulosa: ${brainOut.summary || "(yo'q)"}\n🎯 Niyat: ${brainOut.intent}\n😊 Kayfiyat: ${brainOut.sentiment}\n❓ Javobsiz: ${(brainOut.pending_questions || []).join("; ") || "(yo'q)"}`,
        {link_preview_options: {is_disabled: true}},
      );
    } catch (e) {
      console.error("[Summarize] Error:", e);
      await ctx.reply("Xulosa olishda xatolik.", {link_preview_options: {is_disabled: true}});
    }
  });

  bot.command("draft", async (ctx) => {
    if (!isOwner(ctx)) return;
    const {chatId, rest} = parseChatIdAndRest(ctx.message?.text ?? "");
    if (!chatId || !rest) {
      await ctx.reply("Ishlatish: /draft [chat_id] [ko'rsatma]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const history = await getRecentHistory(chatId);
      const persona = await getPersona(chatId);
      const longTermBlock = await getFactsBlock(chatId);
      const summary = await getConversationSummary(chatId);
      const topFacts = longTermBlock
        .replace(/^What I know about this person:\n- /, "")
        .split("\n- ")
        .filter(Boolean)
        .slice(0, 5);
      const replyCtx: BusinessReplyCtx = {
        contactName: String(chatId),
        daysKnown: persona.firstContactDate ? Math.floor((Date.now() - persona.firstContactDate) / 86400000) : 0,
        messageCount: persona.messageCount,
        relationshipStage: persona.relationshipStage,
        brainSummary: summary,
        topFacts,
        sentiment: "neutral",
        intent: "other",
        urgency: "low",
        detectedLanguage: "uz",
        pendingQuestions: [],
      };
      const draftPrompt = `Write a message from Bekzod to this client with this intent: ${rest}`;
      const historyBlock = history.slice(-10).map((e) => `${e.role === "user" ? "Person" : "You"}: ${e.text}`).join("\n");
      const fullPrompt = `You are Bekzod.\n\n${summary ? `Conversation summary: ${summary}\n\n` : ""}${topFacts.length ? `Known facts: ${topFacts.join(" | ")}\n\n` : ""}Recent history:\n${historyBlock}\n\n${draftPrompt}\n\nWrite in Uzbek or their language. 2-3 sentences max. No JSON, just the message text.`;
      const draft = await callGeminiWithFallback(fullPrompt);
      await ctx.reply(
        `✏️ Qoralama — ${chatId}\n─────────────────────\n${draft}\n─────────────────────\nYuborish uchun: /reply ${chatId} ${draft.slice(0, 50)}...`,
        {link_preview_options: {is_disabled: true}},
      );
    } catch (e) {
      console.error("[Draft] Error:", e);
      await ctx.reply("Qoralama tayyorlanmadi.", {link_preview_options: {is_disabled: true}});
    }
  });
}
