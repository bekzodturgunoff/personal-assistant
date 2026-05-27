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
  get port() {
    return parseInt(getEnv("PORT") || "3000", 10);
  },
  get searchApiKey() {
    return getEnv("SEARCH_API_KEY") || "";
  },
};
