import type {Bot, Context} from "grammy/web";
import {muteChat, unmuteChat} from "../../lib/chat-state.js";

export function setupPublicCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply("Bot is online. Send me a message and I will reply.", {link_preview_options: {is_disabled: true}});
  });

  bot.command("ping", async (ctx) => {
    const ts = new Date().toISOString();
    await ctx.reply(`ok — business handler active | ${ts}`, {link_preview_options: {is_disabled: true}});
  });

  bot.command("mute", async (ctx) => {
    if (!ctx.chat) return;
    await muteChat(ctx.chat.id, "user-requested");
    await ctx.reply("Bot o'chirildi. Qayta yoqish uchun /unmute yozing.", {link_preview_options: {is_disabled: true}});
  });

  bot.command("unmute", async (ctx) => {
    if (!ctx.chat) return;
    await unmuteChat(ctx.chat.id);
    await ctx.reply("Bot qayta yoqildi.", {link_preview_options: {is_disabled: true}});
  });
}
