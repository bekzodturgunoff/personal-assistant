import {Bot} from "grammy/web";
import {config} from "./config.js";
import {setupTelegramHandlers} from "./handlers/telegram.js";

const PUBLIC_COMMANDS = [
  {command: "mute", description: "Stop the bot"},
  {command: "unmute", description: "Resume the bot"},
  {command: "remind", description: "Set a reminder"},
] as const;

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
    await Promise.all([
      bot.api.setMyCommands(PUBLIC_COMMANDS),
      bot.api.setMyCommands(PUBLIC_COMMANDS, {scope: {type: "all_private_chats"}}),
      bot.api.setMyCommands(PUBLIC_COMMANDS, {scope: {type: "all_group_chats"}}),
    ]);
    commandsRegistered = true;
  } catch (err) {
    console.warn("Failed to set bot commands (non-fatal):", err);
  }
}
