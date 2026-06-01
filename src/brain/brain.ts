import type {BrainAnalysis, BrainProvider, BrainOutput} from "./types.js";
import {BRAIN_OUTPUT_DEFAULTS} from "./types.js";
import {createGroqBrainProvider} from "./providers/groq-brain.js";
import {getFullHistory} from "../conversation-memory.js";
import {getConversationsKv, updateUserMeta, getWeeklyAccumulator, saveWeeklyAccumulator} from "../lib/kv-store.js";

let provider: BrainProvider | null = null;

export function setBrainProvider(p: BrainProvider): void {
  provider = p;
}

export function getBrainProvider(): BrainProvider {
  if (!provider) {
    provider = createGroqBrainProvider();
  }
  return provider;
}

const SUMMARY_KEY_PREFIX = "brain:summary:";
const BRAIN_OUTPUT_PREFIX = "brain:output:";
const SUMMARY_INTERVAL = 4;

export async function getConversationSummary(chatId: number): Promise<string> {
  const kv = getConversationsKv();
  if (!kv) return "";
  try {
    return (await kv.get(`${SUMMARY_KEY_PREFIX}${chatId}`)) || "";
  } catch {
    return "";
  }
}

async function setConversationSummary(chatId: number, summary: string): Promise<void> {
  const kv = getConversationsKv();
  if (!kv) return;
  await kv.put(`${SUMMARY_KEY_PREFIX}${chatId}`, summary);
}

export async function getBrainOutput(chatId: number): Promise<BrainOutput | null> {
  const kv = getConversationsKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(`${BRAIN_OUTPUT_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function runBrainAnalysis(
  chatId: number,
  senderName?: string,
  force = false,
): Promise<void> {
  const kv = getConversationsKv();
  if (!kv) return;

  const history = await getFullHistory(chatId);
  const userMessageCount = history.filter((e) => e.role === "user").length;

  if (userMessageCount < 2 && !force) return;

  if (!force && userMessageCount % SUMMARY_INTERVAL !== 0 && userMessageCount !== SUMMARY_INTERVAL) return;

  let isReturning = false;
  try {
    const userMsgs = history.filter((e) => e.role === "user");
    if (userMsgs.length >= 2) {
      const prevMsg = userMsgs[userMsgs.length - 2];
      const daysSince = (Date.now() - prevMsg.timestamp) / 86400000;
      isReturning = daysSince > 7;
    }
  } catch (e) {
    console.error("[Brain] Error checking returning contact:", e);
  }

  const bp = getBrainProvider();
  const currentSummary = await getConversationSummary(chatId);
  const existingFactsRaw = await kv.get(`memory:${chatId}`);
  const existingFacts: string[] = existingFactsRaw
    ? (JSON.parse(existingFactsRaw).facts || [])
    : [];

  console.log(`[Brain] Running analysis for chat ${chatId} (${history.length} entries, ${userMessageCount} user messages)...`);

  let analysis: BrainAnalysis;
  try {
    analysis = await bp.analyze(history, currentSummary, existingFacts, senderName);
  } catch (err) {
    console.error(`[Brain] Analysis failed for chat ${chatId}:`, err);
    return;
  }

  if (analysis.summary && analysis.summary !== currentSummary) {
    await setConversationSummary(chatId, analysis.summary);
    console.log(`[Brain] Summary updated for chat ${chatId}`);
  }

  if (analysis.newFacts.length > 0) {
    const uniqueFacts = analysis.newFacts.filter((f) => !existingFacts.includes(f));
    if (uniqueFacts.length > 0) {
      existingFacts.push(...uniqueFacts);
      const MAX_FACTS = 30;
      const trimmed = existingFacts.slice(-MAX_FACTS);
      await kv.put(`memory:${chatId}`, JSON.stringify({userId: chatId, facts: trimmed, lastUpdated: Date.now()}));
      console.log(`[Brain] ${uniqueFacts.length} new facts stored for chat ${chatId}:`, uniqueFacts);
    }
  }

  const brainOutput: BrainOutput = {
    summary: analysis.summary,
    facts: [...new Set([...existingFacts, ...analysis.newFacts])].slice(-30),
    intent: analysis.intent,
    urgency: analysis.urgency,
    pending_questions: analysis.pending_questions,
    sentiment: analysis.sentiment,
    relationship_stage: analysis.relationship_stage,
    is_returning: isReturning,
    lastUpdated: Date.now(),
  };
  await kv.put(`${BRAIN_OUTPUT_PREFIX}${chatId}`, JSON.stringify(brainOutput));

  await updateUserMeta(String(chatId), {
    pendingQuestions: analysis.pending_questions,
    relationshipStage: analysis.relationship_stage,
    lastIntent: analysis.intent,
    lastSentiment: analysis.sentiment,
    lastUrgency: analysis.urgency,
  });

  const acc = await getWeeklyAccumulator();
  acc.brainRunCount++;
  if (analysis.pending_questions.length > 0) {
    acc.unresolvedCount++;
  }
  await saveWeeklyAccumulator(acc);

  console.log(`[Brain] Analysis complete for chat ${chatId}`);
}
