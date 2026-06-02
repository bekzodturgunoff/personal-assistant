import {getUsageStats} from "../lib/usage-stats.js";
import {getGeminiModels, getGroqModels} from "../lib/model-config.js";
import {getWeeklyAccumulator} from "../memory/index.js";
import {json} from "./helpers.js";

export async function getDashboardData(): Promise<Response> {
  const [usage, geminiModels, groqModels, weekly] = await Promise.all([
    getUsageStats(),
    getGeminiModels(),
    getGroqModels(),
    getWeeklyAccumulator(),
  ]);

  const geminiTotal = Object.values(usage.gemini || {}).reduce(
    (acc, m) => ({inputTokens: acc.inputTokens + m.inputTokens, outputTokens: acc.outputTokens + m.outputTokens, calls: acc.calls + m.calls}),
    {inputTokens: 0, outputTokens: 0, calls: 0},
  );

  const groqTotal = Object.values(usage.groq || {}).reduce(
    (acc, m) => ({inputTokens: acc.inputTokens + m.inputTokens, outputTokens: acc.outputTokens + m.outputTokens, calls: acc.calls + m.calls}),
    {inputTokens: 0, outputTokens: 0, calls: 0},
  );

  const kvWritesEstimated = weekly.totalMessages * 3 + weekly.brainRunCount * 2;
  const kvWritePercent = Math.min(Math.round((kvWritesEstimated / 1000) * 100), 100);

  const topIntent = Object.entries(weekly.intentBreakdown || {}).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
  const topLang = Object.entries(weekly.languageBreakdown || {}).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
  const pos = weekly.sentimentBreakdown.positive;
  const neg = weekly.sentimentBreakdown.negative;
  const sentimentLabel = pos > neg ? "mostly positive" : neg > pos ? "mostly negative" : "mixed";

  return json({
    usage: {
      month: usage.month,
      gemini: {models: usage.gemini, total: geminiTotal},
      groq: {models: usage.groq, total: groqTotal},
    },
    models: {
      gemini: geminiModels,
      groq: groqModels,
    },
    weekly: {
      totalMessages: weekly.totalMessages,
      conversationsSeen: weekly.conversationsSeen.length,
      lowConfTotal: weekly.lowConfTotal,
      unresolvedCount: weekly.unresolvedCount,
      brainRunCount: weekly.brainRunCount,
      languageBreakdown: weekly.languageBreakdown,
      sentimentBreakdown: weekly.sentimentBreakdown,
      intentBreakdown: weekly.intentBreakdown,
      daily: weekly.daily,
      topIntent,
      topLang,
      sentimentLabel,
    },
    health: {
      kvWritePercent,
      kvWritesEstimated,
      modelsInCooldown: 0,
    },
  });
}
