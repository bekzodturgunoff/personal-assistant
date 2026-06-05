import {Bot} from "grammy/web";
import {config} from "./config/env.js";
import {setupTelegramHandlers} from "./handlers/commands/index.js";
import {getBotSettings} from "./lib/bot-settings/index.js";

let commandsRegistered = false;

export function createBot() {
  const bot = new Bot(config.telegramBotToken);

  if (config.debugEnabled) {
    bot.use((ctx, next) => {
      const update = ctx.update as unknown as Record<string, unknown>;
      const keys = Object.keys(update || {});
      const updateId = typeof update.update_id === "number" ? update.update_id : "?";
      const topKey = keys.find((k) => k !== "update_id") || "unknown";
      console.log(`[Bot] update_id=${updateId} type=${topKey} chat=${ctx.chat?.id ?? "?"} chat_type=${ctx.chat?.type ?? "?"}`);
      return next();
    });
  }

  setupTelegramHandlers(bot);

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

export async function registerPublicCommands(bot: Bot): Promise<void> {
  if (commandsRegistered) return;
  try {
    const settings = await getBotSettings();
    const enabled = settings.commands.filter((c) => c.enabled);
    const cmds = enabled.length > 0
      ? enabled.map((c) => ({command: c.name, description: c.description}))
      : [{command: "mute" as const, description: "Stop the bot"}, {command: "unmute" as const, description: "Resume the bot"}, {command: "remind" as const, description: "Set a reminder"}];
    await Promise.all([
      bot.api.setMyCommands(cmds),
      bot.api.setMyCommands(cmds, {scope: {type: "all_private_chats"}}),
      bot.api.setMyCommands(cmds, {scope: {type: "all_group_chats"}}),
    ]);
    commandsRegistered = true;
  } catch (err) {
    console.warn("Failed to set bot commands (non-fatal):", err);
  }
}
