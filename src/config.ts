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
  get groqApiKey() {
    return getEnv("GROQ_API_KEY") || "";
  },
  get port() {
    return parseInt(getEnv("PORT") || "3000", 10);
  },
  get searchApiKey() {
    return getEnv("SEARCH_API_KEY") || "";
  },
  get webhookSecret() {
    return getEnv("TELEGRAM_WEBHOOK_SECRET") || "";
  },
  /**
   * Your personal Telegram user ID (numeric).
   * Used for:
   *   - Handoff alerts when the bot gets stuck in low-confidence conversations
   *   - Weekly analytics briefings (every Monday 3AM)
   *   - Morning briefing with tasks and pending questions (daily 3AM)
   * Set OWNER_USER_ID in your Cloudflare environment variables or .dev.vars.
   * Optional — if missing the bot degrades gracefully (no alerts/briefings).
   */
  get ownerUserId(): number {
    const v = getEnv("OWNER_USER_ID");
    if (!v) {
      console.warn("[Config] OWNER_USER_ID not set — handoff alerts and analytics briefings disabled");
      return 0;
    }
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) {
      console.warn("[Config] OWNER_USER_ID is not a valid number — handoff alerts and analytics briefings disabled");
      return 0;
    }
    return n;
  },
  get dashboardUsername(): string {
    return getEnv("DASHBOARD_USERNAME") || "admin";
  },
  get dashboardPassword(): string {
    return getEnv("DASHBOARD_PASSWORD") || "mac21012990";
  },
};
