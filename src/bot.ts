import {Bot} from "grammy/web";
import {config} from "./config.js";
import {setupTelegramHandlers} from "./handlers/telegram.js";
import {getBotSettings} from "./lib/bot-settings.js";

let commandsRegistered = false;

export function createBot() {
  const bot = new Bot(config.telegramBotToken);

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
    const cmds = settings.commands.length > 0
      ? settings.commands.map((c) => ({command: c.command, description: c.description}))
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
