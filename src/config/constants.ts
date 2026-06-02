export const KV_KEYS = {
  SETTINGS: "_settings",
  ACCUMULATOR: "analytics:current",
  USAGE: "usage:stats",
  GEMINI_CONFIG: "config:models:gemini",
  GROQ_CONFIG: "config:models:groq",
  PERSONA_HISTORY: "persona_history",
  OWNER_PROFILE: "owner_profile",
  META_PREFIX: "meta:",
  BRAIN_SUMMARY_PREFIX: "brain:summary:",
  BRAIN_OUTPUT_PREFIX: "brain:output:",
  MEMORY_PREFIX: "memory:",
  TIMING_PREFIX: "timing:",
  PENDING_PREFIX: "pending:",
  PAUSED_PREFIX: "paused:",
  COOLDOWN_PREFIX: "cooldown:",
  PERSONA_PREFIX: "persona:",
  CHAT_PREFIX: "chat:",
  TASKS_PREFIX: "tasks:",
  MUTED_PREFIX: "muted:",
} as const;

export const LIMITS = {
  MAX_HISTORY: 100,
  MAX_CONTEXT: 50,
  MAX_FACTS_BRAIN: 30,
  MAX_FACTS_MEMORY: 20,
  COMPRESSED_FACTS_LIMIT: 10,
  PERSONA_HISTORY_MAX: 10,
  DAILY_ENTRIES_MAX: 14,
  SUMMARY_INTERVAL: 8,
  BRAIN_ANALYSIS_USER_MIN: 2,
  HISTORY_RECENT_COUNT: 10,
  RANKED_FACTS_LIMIT: 5,
  COMMANDS_FALLBACK_COUNT: 3,
} as const;

export const TIMING = {
  CACHE_TTL_MS: 30_000,
  COOLDOWN_MS: 86_400_000,
  DAY_MS: 86_400_000,
  GROQ_FETCH_TIMEOUT_MS: 15_000,
  BUSINESS_API_TIMEOUT_MS: 5_000,
  BUSINESS_SEND_TIMEOUT_MS: 10_000,
  TASK_API_TIMEOUT_MS: 10_000,
  DEBUG_SEND_TIMEOUT_MS: 10_000,
  DASHBOARD_WEBHOOK_TIMEOUT_MS: 25_000,
  MORNING_BRIEFING_HOUR_OFFSET: 3,
} as const;

export const DEFAULTS = {
  PORT: 3000,
  CONVERSATION_GAP_MINUTES: 30,
  FIRST_REPLY_DELAY_SECONDS: 240,
  SLOW_REPLY_DELAY_SECONDS: 240,
  NORMAL_REPLY_DELAY_SECONDS: 90,
  SLOW_THRESHOLD_SECONDS: 180,
  RANDOM_EXTRA_MAX_SECONDS: 120,
  FALLBACK_THRESHOLD: 0.65,
  LOW_CONF_ALERT_THRESHOLD: 3,
  TYPING_MS_PER_CHAR: 45,
  TYPING_MAX_MS: 4_000,
  GROUP_REPLY_COOLDOWN_MS: 12_000,
  MAX_RESPONSE_CHARS: 500,
  MAX_RESPONSE_SENTENCES: 3,
  BRAIN_ANALYSIS_INTERVAL: 4,
  RETURNING_CONTACT_DAYS: 7,
  GROQ_TEMPERATURE_JSON: 0.3,
  GROQ_TEMPERATURE_CHAT: 0.8,
  GROQ_MAX_TOKENS_JSON: 1_024,
  GROQ_MAX_TOKENS_CHAT: 512,
} as const;

export const RELATIONSHIP_THRESHOLDS = {
  CLOSE: 30,
  REGULAR: 12,
  FAMILIAR: 4,
} as const;

export const API_URLS = {
  GROQ: "https://api.groq.com/openai/v1/chat/completions",
  TELEGRAM_BOT: "https://api.telegram.org/bot",
} as const;

export const MODEL_NAMES = {
  GEMINI_DEFAULT: [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
  ],
  GROQ_CHAT_DEFAULT: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  GROQ_JSON_DEFAULT: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
} as const;

export const ENV_NAMES = {
  TELEGRAM_BOT_TOKEN: "TELEGRAM_BOT_TOKEN",
  AI_API_KEY: "AI_API_KEY",
  GROQ_API_KEY: "GROQ_API_KEY",
  PORT: "PORT",
  SEARCH_API_KEY: "SEARCH_API_KEY",
  TELEGRAM_WEBHOOK_SECRET: "TELEGRAM_WEBHOOK_SECRET",
  OWNER_USER_ID: "OWNER_USER_ID",
  DASHBOARD_USERNAME: "DASHBOARD_USERNAME",
  DASHBOARD_PASSWORD: "DASHBOARD_PASSWORD",
  DEBUG_ENABLED: "DEBUG_ENABLED",
  WEBHOOK_URL: "WEBHOOK_URL",
  AI_MODEL: "AI_MODEL",
  AI_FALLBACK_MODEL: "AI_FALLBACK_MODEL",
  AI_FALLBACK_MODEL_2: "AI_FALLBACK_MODEL_2",
  AI_FALLBACK_MODEL_3: "AI_FALLBACK_MODEL_3",
  AI_FALLBACK_MODEL_4: "AI_FALLBACK_MODEL_4",
} as const;

export const QUOTA_SIGNALS = [
  "resource_exhausted",
  "quota",
  "rate limit",
  "too many requests",
  "limit exceeded",
] as const;

export const SKIP_REPLY_ACKNOWLEDGMENTS = /^(ok|okay|yaxshi|bo'pti|tushunarli|mayli|ha|xo'p|хорошо|ладно|понял|ок)\.?$/i;

export const EMOJI_ONLY = /^\p{Emoji_Presentation}+$/u;

export const PUNCTUATION_ONLY = /^[.!?…,]+$/;
