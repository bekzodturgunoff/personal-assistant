import type {Bot, Context} from "grammy/web";
import {isOwner, getContactName, parseChatId} from "./helpers.js";
import {getConversationsKv, getLongTermKv, getUserMeta, getWeeklyAccumulator} from "../../memory/index.js";
import {getConversationSummary, getBrainOutput} from "../../brain/brain.js";
import {getFactsBlock} from "../../long-term-memory.js";
import {formatTashkentTime} from "../../lib/reply-timing.js";
import {handleWeeklyAnalytics} from "../tasks/index.js";

export function setupOwnerInfoCommands(bot: Bot): void {
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

  bot.command("weekly", async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      await handleWeeklyAnalytics();
      await ctx.reply("📊 Haftalik hisobot yuborildi.", {link_preview_options: {is_disabled: true}});
    } catch (e) {
      console.error("[Weekly] Error:", e);
    }
  });
}
