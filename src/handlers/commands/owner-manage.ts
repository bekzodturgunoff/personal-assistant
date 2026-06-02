import type {Bot, Context} from "grammy/web";
import type {UserMeta} from "../../memory/index.js";
import {getLongTermKv, getUserMeta, updateUserMeta, deleteLongTermKey, deleteConversationsKey, setPausedUntil, clearPausedUntil} from "../../memory/index.js";
import {isOwner, getContactName, parseChatId, parseChatIdAndRest} from "./helpers.js";

export function setupOwnerManageCommands(bot: Bot): void {
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
}
