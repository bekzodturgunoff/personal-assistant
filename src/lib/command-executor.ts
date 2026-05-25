import {
  chat,
  commandResponse,
  roast,
} from "../prompts/octobot.js";
import {
  matchesFallbackTrigger,
  isLocalJokeModeActive,
} from "../ai.js";

// This module will eventually be split further — keeping backward compat for now

export {
  chat,
  commandResponse,
  roast,
  matchesFallbackTrigger,
  isLocalJokeModeActive,
};
