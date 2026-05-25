// Re-exports for backward compatibility
// All logic moved to src/lib/ and src/prompts/

export {
  isVeryShortQuestion,
  isCreatorQuestion,
  randomPersonality,
  limitResponse,
  generateWithFallback,
} from "./lib/gemini.js";

export {
  isLocalJokeModeActive,
  matchesFallbackTrigger,
} from "./lib/jokes.js";

export {
  chat,
  commandResponse,
  roast,
} from "./prompts/octobot.js";

export {
  businessAssistantReply,
} from "./prompts/business.js";
