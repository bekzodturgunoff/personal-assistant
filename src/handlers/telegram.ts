// COMMANDS: status, pending, chats, memory, forget, forget_confirm, promote,
//           note, pause, unpause, test, setlang, budget, reply, summarize,
//           tone, draft, weekly, ping, mute, unmute

import type {Bot, Context} from "grammy/web";
import {config} from "../config.js";
import {handleTaskCommand, handleWeeklyAnalytics} from "./tasks.js";
import {businessAssistantReply} from "../prompts/business.js";
import type {ReplyContext as BusinessReplyCtx} from "../prompts/business.js";
import {evaluateConfidence} from "../lib/confidence-scorer.js";
import {classifyIntent} from "../lib/intent-classifier.js";
import {addMessage, getRecentHistory} from "../conversation-memory.js";
import {recordMessage, getPersona} from "../persona-memory.js";
import {extractAndStoreFact, getFactsBlock} from "../long-term-memory.js";
import {isChatMuted, muteChat, unmuteChat} from "../lib/chat-state.js";
import {getConversationSummary, runBrainAnalysis, getBrainOutput} from "../brain/brain.js";
import type {UserMeta} from "../lib/kv-store.js";
import {
  getConversationsKv,
  getUserMeta,
  updateUserMeta,
  getWeeklyAccumulator,
  saveWeeklyAccumulator,
  deleteLongTermKey,
  deleteConversationsKey,
  setPausedUntil,
  clearPausedUntil,
  getLongTermKv,
} from "../lib/kv-store.js";
import {formatTashkentTime} from "../lib/reply-timing.js";
import {callGeminiWithFallback, callGeminiStructured} from "../lib/gemini.js";

const TG_API = "https://api.telegram.org/bot";
const OWNER_ID = config.ownerUserId;

function tgUrl(method: string): string {
  return `${TG_API}${config.telegramBotToken}/${method}`;
}

function isOwner(ctx: Context): boolean {
  return ctx.from?.id === OWNER_ID;
}

async function getContactName(chatId: number | string): Promise<string> {
  try {
    const persona = await getPersona(Number(chatId));
    return persona && persona.messageCount > 0 ? `Chat ${chatId}` : String(chatId);
  } catch {
    return String(chatId);
  }
}

function parseChatId(text: string): number | null {
  const parts = text.split(/\s+/);
  const idStr = parts[1];
  if (!idStr) return null;
  const n = Number(idStr);
  return Number.isNaN(n) ? null : n;
}

function parseChatIdAndRest(text: string): {chatId: number | null; rest: string} {
  const parts = text.split(/\s+/);
  const idStr = parts[1];
  if (!idStr) return {chatId: null, rest: ""};
  const n = Number(idStr);
  if (Number.isNaN(n)) return {chatId: null, rest: ""};
  return {chatId: n, rest: parts.slice(2).join(" ")};
}

// ── Helper: send a message via Telegram Business API ──
async function sendBusinessMessage(businessConnectionId: string, chatId: number, text: string): Promise<boolean> {
  try {
    const res = await fetch(tgUrl("sendMessage"), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        business_connection_id: businessConnectionId,
        chat_id: chatId,
        text,
        link_preview_options: {is_disabled: true},
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function setupTelegramHandlers(bot: Bot) {
  // ── Router ──
  bot.use(async (ctx, next) => {
    const update = ctx.update as unknown as Record<string, unknown>;
    const hasBusiness = !!(update.business_connection || update.business_message || update.edited_business_message);
    console.log(`[Router] msg="${(ctx.message?.text ?? "").slice(0, 60)}" | business=${hasBusiness} | type=${ctx.chat?.type ?? "?"}`);
    if (hasBusiness) {
      try {
        const {handleBusinessUpdate} = await import("./business.js");
        await handleBusinessUpdate(bot, update);
      } catch (e) {
        console.error(`[Router] Business update failed:`, e);
      }
      return;
    }
    await next();
  });

  // ── /ping (public) ──
  bot.command("ping", async (ctx) => {
    const ts = new Date().toISOString();
    await ctx.reply(`ok — business handler active | ${ts}`, {link_preview_options: {is_disabled: true}});
  });

  // ── /mute (public) ──
  bot.command("mute", async (ctx) => {
    if (!ctx.chat) return;
    await muteChat(ctx.chat.id, "user-requested");
    await ctx.reply("Bot o'chirildi. Qayta yoqish uchun /unmute yozing.", {link_preview_options: {is_disabled: true}});
  });

  // ── /unmute (public) ──
  bot.command("unmute", async (ctx) => {
    if (!ctx.chat) return;
    await unmuteChat(ctx.chat.id);
    await ctx.reply("Bot qayta yoqildi.", {link_preview_options: {is_disabled: true}});
  });

  // ════════════════════════════════════════════
  // OWNER-ONLY COMMANDS
  // ════════════════════════════════════════════

  // ── /status ──
  bot.command("status", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const convKv = getConversationsKv();
      let chatCount = "?";
      try {
        if (convKv?.list) {
          const result = await convKv.list({prefix: "chat:"});
          chatCount = String(result.keys.length);
        }
      } catch { /* keep ? */ }
      const acc = await getWeeklyAccumulator();
      const tashkent = formatTashkentTime();
      await ctx.reply(
        `🤖 Bot holati\n─────────────\n🔇 Ovoz: Yoqilgan\n💬 Faol suhbatlar: ${chatCount}\n🧠 Brain ishlagan: ${acc.brainRunCount}\n📅 Bugun: ${tashkent}\n✅ Hammasi yaxshi`,
        {link_preview_options: {is_disabled: true}},
      );
    } catch (e) {
      console.error("[Status] Error:", e);
    }
  });

  // ── /pending (owner only) ──
  bot.command("pending", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const longKv = getLongTermKv();
      if (!longKv?.list) {
        await ctx.reply("❌ KV list not available.", {link_preview_options: {is_disabled: true}});
        return;
      }
      const result = await longKv.list({prefix: "meta:"});
      const lines: string[] = [];
      for (const key of result.keys) {
        try {
          const raw = await longKv.get(key.name);
          if (!raw) continue;
          const meta = JSON.parse(raw);
          const pqs = meta.pendingQuestions || [];
          if (pqs.length === 0) continue;
          const chatId = key.name.replace("meta:", "");
          const name = await getContactName(Number(chatId));
          for (const q of pqs) {
            lines.push(`• ${name}: "${q}"`);
          }
        } catch { /* skip bad key */ }
      }
      if (lines.length === 0) {
        await ctx.reply("✅ Hamma savollarga javob berilgan", {link_preview_options: {is_disabled: true}});
      } else {
        await ctx.reply(`❓ Javob kutayotgan savollar:\n${lines.join("\n")}`, {link_preview_options: {is_disabled: true}});
      }
    } catch (e) {
      console.error("[Pending] Error:", e);
    }
  });

  // ── /chats (owner only) ──
  bot.command("chats", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const acc = await getWeeklyAccumulator();
      const entries = Object.entries(acc.chatMessages)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      if (entries.length === 0) {
        await ctx.reply("Bu hafta hech qanday faol suhbat yo'q.", {link_preview_options: {is_disabled: true}});
        return;
      }
      const lines: string[] = ["📊 Eng faol suhbatlar:"];
      for (let i = 0; i < entries.length; i++) {
        const [cid, count] = entries[i];
        const name = await getContactName(Number(cid));
        let summary = "";
        try {
          const brainOut = await getBrainOutput(Number(cid));
          if (brainOut?.summary) {
            summary = " — " + brainOut.summary.split(".")[0];
          }
        } catch { /* no summary */ }
        lines.push(`${i + 1}. ${name} (${count} xabar)${summary}`);
      }
      await ctx.reply(lines.join("\n"), {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Chats] Error:", e);
    }
  });

  // ── /memory [chat_id] (owner only) ──
  bot.command("memory", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /memory [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const meta = await getUserMeta(String(chatId));
      const summary = await getConversationSummary(chatId);
      const factsBlock = await getFactsBlock(chatId);
      const daysKnown = meta.firstContactDate
        ? Math.floor((Date.now() - new Date(meta.firstContactDate).getTime()) / 86400000)
        : 0;
      let factsList = "";
      if (factsBlock) {
        factsList = factsBlock
          .replace(/^What I know about this person:\n- /, "")
          .split("\n- ")
          .filter(Boolean)
          .map((f) => `  • ${f}`)
          .join("\n");
      }
      const msg = [
        `🧠 Xotira: ${chatId}`,
        `─────────────────────`,
        `📋 Xulosa: ${summary || "(yo'q)"}`,
        `👤 Bosqich: ${meta.relationshipStage}`,
        `📊 Xabarlar: ${meta.messageCount} | ${daysKnown} kun`,
        factsList ? `💡 Faktlar:\n${factsList}` : "💡 Faktlar: (yo'q)",
        `❓ Javobsiz: ${meta.pendingQuestions.length}`,
      ].join("\n");
      await ctx.reply(msg, {link_preview_options: {is_disabled: true}});
    } catch {
      await ctx.reply(`Bu chat uchun xotira topilmadi.`, {link_preview_options: {is_disabled: true}});
    }
  });

  // ── /forget [chat_id] (owner only) ──
  bot.command("forget", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /forget [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    await ctx.reply(
      `⚠️ Ishonchingiz komilmi? /forget_confirm ${chatId} deb yuboring.`,
      {link_preview_options: {is_disabled: true}},
    );
  });

  // ── /forget_confirm [chat_id] (owner only) ──
  bot.command("forget_confirm", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /forget_confirm [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      await deleteLongTermKey(`meta:${chatId}`);
      await deleteLongTermKey(`memory:${chatId}`);
      await deleteConversationsKey(`brain:summary:${chatId}`);
      await deleteConversationsKey(`persona:${chatId}`);
      await ctx.reply(`🗑 ${chatId} uchun xotira tozalandi. Ular endi yangi odam.`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Forget] Error:", e);
      await ctx.reply(`Xatolik yuz berdi.`, {link_preview_options: {is_disabled: true}});
    }
  });

  // ── /promote [chat_id] (owner only) ──
  bot.command("promote", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /promote [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const meta = await getUserMeta(String(chatId));
      const oldStage = meta.relationshipStage;
      const stages: UserMeta["relationshipStage"][] = ["stranger", "acquaintance", "warm_lead", "regular"];
      const idx = stages.indexOf(oldStage);
      if (idx === -1 || idx >= stages.length - 1) {
        await ctx.reply("Bu kontakt allaqachon eng yuqori bosqichda.", {link_preview_options: {is_disabled: true}});
        return;
      }
      const newStage = stages[idx + 1];
      await updateUserMeta(String(chatId), { relationshipStage: newStage });
      const name = await getContactName(chatId);
      await ctx.reply(`⬆️ ${name} bosqichi: ${oldStage} → ${newStage}`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Promote] Error:", e);
    }
  });

  // ── /note [chat_id] [text] (owner only) ──
  bot.command("note", async (ctx) => {
    if (!isOwner(ctx)) return;
    const {chatId, rest} = parseChatIdAndRest(ctx.message?.text ?? "");
    if (!chatId || !rest) {
      await ctx.reply("Ishlatish: /note [chat_id] [matn]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      const kv = getLongTermKv();
      if (!kv) return;
      const key = `memory:${chatId}`;
      const raw = await kv.get(key);
      const memory: {userId: number; facts: string[]; lastUpdated: number} = raw
        ? JSON.parse(raw)
        : {userId: chatId, facts: [], lastUpdated: 0};
      const fact = `Client ${rest}`;
      if (!memory.facts.includes(fact)) {
        memory.facts.push(fact);
        memory.lastUpdated = Date.now();
        if (memory.facts.length > 20) {
          memory.facts = memory.facts.slice(-10);
        }
        await kv.put(key, JSON.stringify(memory));
      }
      await ctx.reply(`📝 Eslatma qo'shildi: "${fact}"`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Note] Error:", e);
    }
  });

  // ── /pause [chat_id] [minutes] (owner only) ──
  bot.command("pause", async (ctx) => {
    if (!isOwner(ctx)) return;
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const chatId = parts[1] ? Number(parts[1]) : null;
    if (!chatId || Number.isNaN(chatId)) {
      await ctx.reply("Ishlatish: /pause [chat_id] [daqiqa]", {link_preview_options: {is_disabled: true}});
      return;
    }
    const minutes = Math.min(Math.max(parseInt(parts[2] || "60", 10) || 60, 1), 1440);
    try {
      const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await setPausedUntil(String(chatId), until);
      const name = await getContactName(chatId);
      await ctx.reply(`⏸ ${name} uchun ${minutes} daqiqa to'xtatildi.`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Pause] Error:", e);
    }
  });

  // ── /unpause [chat_id] (owner only) ──
  bot.command("unpause", async (ctx) => {
    if (!isOwner(ctx)) return;
    const chatId = parseChatId(ctx.message?.text ?? "");
    if (!chatId) {
      await ctx.reply("Ishlatish: /unpause [chat_id]", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      await clearPausedUntil(String(chatId));
      const name = await getContactName(chatId);
      await ctx.reply(`▶️ ${name} uchun pauza olib tashlandi.`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Unpause] Error:", e);
    }
  });

  // ── /test [chat_id] [message] (owner only) ──
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

  // ── /setlang [chat_id] [uz|ru|en|auto] (owner only) ──
  bot.command("setlang", async (ctx) => {
    if (!isOwner(ctx)) return;
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const chatId = parts[1] ? Number(parts[1]) : null;
    if (!chatId || Number.isNaN(chatId) || !parts[2]) {
      await ctx.reply("Ishlatish: /setlang [chat_id] [uz|ru|en|auto]", {link_preview_options: {is_disabled: true}});
      return;
    }
    const lang = parts[2].toLowerCase();
    if (!["uz", "ru", "en", "auto"].includes(lang)) {
      await ctx.reply("Tillar: uz, ru, en, auto", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      await updateUserMeta(String(chatId), { forcedLanguage: lang === "auto" ? "" : lang as "uz" | "ru" | "en" });
      const name = await getContactName(chatId);
      const displayLang = lang === "auto" ? "avtomatik" : lang;
      await ctx.reply(`🌐 ${name} uchun til belgilandi: ${displayLang}`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Setlang] Error:", e);
    }
  });

  // ── /budget (owner only) ──
  bot.command("budget", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const acc = await getWeeklyAccumulator();
      const msgs = acc.totalMessages;
      const brain = acc.brainRunCount;
      const estWrites = (msgs * 3) + (brain * 2);
      const estReads = (msgs * 4) + (brain * 3);
      await ctx.reply(
        `📦 KV byudjet (bugun)\n─────────────────────\n✍️ Yozishlar: ~${estWrites} / 1,000\n📖 O'qishlar: ~${estReads} / 100,000\n💬 Xabarlar: ${msgs}\n🧠 Brain: ${brain}\n\n*Taxminiy hisob-kitob`,
        {link_preview_options: {is_disabled: true}},
      );
    } catch (e) {
      console.error("[Budget] Error:", e);
    }
  });

  // ── /reply [chat_id] [text] (owner only) ──
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

  // ── /summarize [chat_id] (owner only) ──
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

  // ── /tone [chat_id] [formal|casual|warm|auto] (owner only) ──
  bot.command("tone", async (ctx) => {
    if (!isOwner(ctx)) return;
    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const chatId = parts[1] ? Number(parts[1]) : null;
    if (!chatId || Number.isNaN(chatId) || !parts[2]) {
      await ctx.reply("Ishlatish: /tone [chat_id] [formal|casual|warm|auto]", {link_preview_options: {is_disabled: true}});
      return;
    }
    const tone = parts[2].toLowerCase();
    if (!["formal", "casual", "warm", "auto"].includes(tone)) {
      await ctx.reply("Tonlar: formal, casual, warm, auto", {link_preview_options: {is_disabled: true}});
      return;
    }
    try {
      await updateUserMeta(String(chatId), { forcedTone: tone === "auto" ? "" : tone as "formal" | "casual" | "warm" });
      const name = await getContactName(chatId);
      await ctx.reply(`🎭 ${name} uchun ton: ${tone}`, {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Tone] Error:", e);
    }
  });

  // ── /draft [chat_id] [prompt] (owner only) ──
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

  // ── /weekly (owner only) ──
  bot.command("weekly", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      await handleWeeklyAnalytics();
      await ctx.reply("📊 Haftalik hisobot yuborildi.", {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Weekly] Error:", e);
    }
  });

  // ── DM text handler ──
  const lastDmTime = new Map<number, number>();

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

      const enhanced = await (await import("./search.js")).enhanceWithSearch(text);
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
      const fallbacks = [
        "Hozir bandman, keyinroq javob beraman",
        "Sal gaplashamiz keyin, hozir ish bilan bandman",
        "Keyinroq yozaman, hozir biroz band",
        "Hozir qo'lim tegmayapti, keyin albatta javob beraman",
        "Hozir boshqa ish bilan bandman, keyin yozaman",
      ];
      await ctx.reply(fallbacks[Math.floor(Math.random() * fallbacks.length)], {link_preview_options: {is_disabled: true}});
    }
  });
}
