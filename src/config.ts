import {getEnv} from "./runtime-env.js";

function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  get telegramBotToken() {
    return requireEnv("TELEGRAM_BOT_TOKEN");
  },
  get aiApiKey() {
    return getEnv("AI_API_KEY") || "";
  },
  // telegramChatId is optional. If set, GitHub notifications go there.
  // Otherwise the bot will use subscribed chats discovered at runtime.
  get telegramChatId() {
    return getEnv("TELEGRAM_CHAT_ID") || "";
  },
  get port() {
    return parseInt(getEnv("PORT") || "3000", 10);
  },
  get githubWebhookSecret() {
    return getEnv("GITHUB_WEBHOOK_SECRET") || "";
  },
  get searchApiKey() {
    return getEnv("SEARCH_API_KEY") || "";
  },
  get ownerChatId() {
    return getEnv("OWNER_CHAT_ID") || "";
  },
};
