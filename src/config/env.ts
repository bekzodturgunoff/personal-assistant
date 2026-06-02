import {ENV_NAMES, DEFAULTS} from "./constants.js";

type EnvLike = Record<string, unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __OCTOPOS_ENV__: EnvLike | undefined;
}

export function setRuntimeEnv(env: EnvLike): void {
  globalThis.__OCTOPOS_ENV__ = env;
}

export function getEnv(name: string): string | undefined {
  const runtimeEnv = globalThis.__OCTOPOS_ENV__;
  const runtimeValue = runtimeEnv?.[name];
  if (typeof runtimeValue === "string" && runtimeValue.length > 0) {
    return runtimeValue;
  }

  if (typeof process !== "undefined" && process.env) {
    const processValue = process.env[name];
    if (typeof processValue === "string" && processValue.length > 0) {
      return processValue;
    }
  }

  return undefined;
}

export function getBinding<T = unknown>(name: string): T | undefined {
  return globalThis.__OCTOPOS_ENV__?.[name] as T | undefined;
}

function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseOwnerUserId(v: string | undefined): number {
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
}

export const config = {
  get telegramBotToken() {
    return requireEnv(ENV_NAMES.TELEGRAM_BOT_TOKEN);
  },
  get aiApiKey() {
    return getEnv(ENV_NAMES.AI_API_KEY) || "";
  },
  get groqApiKey() {
    return getEnv(ENV_NAMES.GROQ_API_KEY) || "";
  },
  get port() {
    return parseInt(getEnv(ENV_NAMES.PORT) || String(DEFAULTS.PORT), 10);
  },
  get searchApiKey() {
    return getEnv(ENV_NAMES.SEARCH_API_KEY) || "";
  },
  get webhookSecret() {
    return getEnv(ENV_NAMES.TELEGRAM_WEBHOOK_SECRET) || "";
  },
  get ownerUserId(): number {
    return parseOwnerUserId(getEnv(ENV_NAMES.OWNER_USER_ID));
  },
  get dashboardUsername(): string {
    return getEnv(ENV_NAMES.DASHBOARD_USERNAME) || "";
  },
  get dashboardPassword(): string {
    return getEnv(ENV_NAMES.DASHBOARD_PASSWORD) || "";
  },
  get debugEnabled(): boolean {
    return getEnv(ENV_NAMES.DEBUG_ENABLED) === "true";
  },
};
