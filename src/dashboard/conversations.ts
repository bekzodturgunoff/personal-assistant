import type {UserMeta} from "../memory/index.js";
import {getConversationsKv, getLongTermKv, getUserMeta, updateUserMeta, setPausedUntil, clearPausedUntil, deleteLongTermKey, deleteConversationsKey, getWeeklyAccumulator, saveWeeklyAccumulator} from "../memory/index.js";
import {getPersona} from "../persona-memory.js";
import type {BrainOutput} from "../brain/types.js";
import {runBrainAnalysis} from "../brain/brain.js";
import {config} from "../config/env.js";
import {json} from "./helpers.js";

export async function getFullConversationsList(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json([]);
  const result = await kv.list({prefix: "chat:"});
  const contacts = await Promise.all(result.keys.slice(0, 50).map(async (key) => {
    const chatId = key.name.replace("chat:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const entries = JSON.parse(raw) as Array<{role: string; text: string; timestamp: number}>;
      const last = entries[entries.length - 1];
      if (!last) return null;
      const [brainRaw, metaRaw, mutedRaw, pendingRaw] = await Promise.all([
        kv.get(`brain:output:${chatId}`),
        kv.get(`meta:${chatId}`),
        kv.get(`muted:${chatId}`),
        kv.get(`pending:${chatId}`),
      ]);
      const brain = brainRaw ? JSON.parse(brainRaw) as BrainOutput : null;
      const meta = metaRaw ? JSON.parse(metaRaw) as UserMeta : null;
      const muted = mutedRaw === "true";
      const pendingReply = !!pendingRaw;
      return {
        chatId,
        lastMessage: last.text,
        lastMessageAt: last.timestamp,
        messageCount: entries.length,
        muted,
        pendingReply,
        relationshipStage: meta?.relationshipStage || "stranger",
        detectedLanguage: meta?.forcedLanguage || brain?.detectedLanguage || "",
        intent: brain?.intent || meta?.lastIntent || "",
        sentiment: brain?.sentiment || meta?.lastSentiment || "",
        urgency: brain?.urgency || meta?.lastUrgency || "",
        personaNotes: brain?.persona_notes || "",
        flaggedForHandoff: (brain?.urgency === "high" || meta?.lastUrgency === "high") && pendingReply,
      };
    } catch { return null; }
  }));
  const filtered = contacts.filter(Boolean).sort((a, b) => (b!.lastMessageAt || 0) - (a!.lastMessageAt || 0));
  return json(filtered);
}

export async function getConversationDetail(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const [chatRaw, brainRaw, summaryRaw, metaRaw] = await Promise.all([
    kv.get(`chat:${chatId}`),
    kv.get(`brain:output:${chatId}`),
    kv.get(`brain:summary:${chatId}`),
    kv.get(`meta:${chatId}`),
  ]);
  const entries = chatRaw ? JSON.parse(chatRaw) : [];
  const brainOutput = brainRaw ? JSON.parse(brainRaw) : null;
  const summary = summaryRaw || "";
  const meta = metaRaw ? JSON.parse(metaRaw) : null;
  return json({entries, brainOutput, summary, meta});
}

export async function handleConversationMuteGet(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({muted: false});
  const raw = await kv.get(`muted:${chatId}`);
  return json({muted: raw === "true"});
}

export async function handleConversationMute(chatId: string, body: string): Promise<Response> {
  const {muted} = JSON.parse(body) as {muted?: boolean};
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await kv.put(`muted:${chatId}`, muted ? "true" : "false");
  return json({ok: true});
}

export async function handleConversationInject(chatId: string, body: string): Promise<Response> {
  const {text} = JSON.parse(body) as {text?: string};
  if (!text) return json({error: "text required"}, 400);
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const entry = {role: "assistant" as const, text, timestamp: Date.now()};
  const raw = await kv.get(`chat:${chatId}`);
  const history = raw ? JSON.parse(raw) : [];
  history.push(entry);
  await kv.put(`chat:${chatId}`, JSON.stringify(history));
  const tgUrl = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  await fetch(tgUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: parseInt(chatId, 10), text, link_preview_options: {is_disabled: true}}),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => console.error("[Inject] Telegram send error:", e));
  return json({ok: true});
}

export async function handleCancelPending(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const raw = await kv.get(`pending:${chatId}`);
  if (raw) {
    await kv.delete?.(`pending:${chatId}`);
    return json({ok: true, cancelled: 1});
  }
  return json({ok: true, cancelled: 0});
}

export async function handleConversationBrainReset(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await Promise.all([
    kv.delete?.(`brain:output:${chatId}`),
    kv.delete?.(`brain:summary:${chatId}`),
  ]);
  return json({ok: true});
}

export async function handleConversationBrainRun(chatId: string): Promise<Response> {
  await runBrainAnalysis(parseInt(chatId, 10), "Dashboard", true);
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const brainRaw = await kv.get(`brain:output:${chatId}`);
  const output = brainRaw ? JSON.parse(brainRaw) : null;
  return json({ok: true, output});
}

export async function handleConversationMetaPatch(chatId: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<UserMeta>;
  await updateUserMeta(chatId, patch);
  return json({ok: true});
}

export async function getConversationsList(): Promise<Response> {
  const kv = getLongTermKv();
  if (!kv || !kv.list) return json([]);
  const result = await kv.list({prefix: "meta:"});
  const slice = result.keys.slice(0, 50);
  const list = await Promise.all(slice.map(async (key) => {
    const chatId = key.name.replace("meta:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const meta = JSON.parse(raw) as UserMeta;
      const convKv = getConversationsKv();
      let brainSummaryShort = "";
      if (convKv) {
        const summary = await convKv.get(`brain:summary:${chatId}`);
        if (summary) brainSummaryShort = summary.split(".")[0] + ".";
      }
      let isPaused = false;
      try {
        const pausedRaw = await kv.get(`paused:${chatId}`);
        if (pausedRaw) isPaused = Date.now() < new Date(pausedRaw).getTime();
      } catch { /* ignore */ }
      return {
        chatId, contactName: meta.businessConnectionId ? chatId : chatId,
        relationshipStage: meta.relationshipStage, messageCount: meta.messageCount,
        lastMessageAt: meta.lastMessageTimestamp ? new Date(meta.lastMessageTimestamp).toISOString() : null,
        daysSinceLastMessage: meta.lastMessageTimestamp ? Math.floor((Date.now() - meta.lastMessageTimestamp) / 86400000) : null,
        pendingQuestionsCount: (meta.pendingQuestions || []).length,
        lastIntent: meta.lastIntent, lastSentiment: meta.lastSentiment, lastUrgency: meta.lastUrgency,
        isPaused, brainSummaryShort, lowConfCount: meta.lowConfCount || 0,
      };
    } catch { return null; }
  }));
  const filtered = list.filter(Boolean).sort((a, b) => {
    const at = a!.lastMessageAt ? new Date(a!.lastMessageAt).getTime() : 0;
    const bt = b!.lastMessageAt ? new Date(b!.lastMessageAt).getTime() : 0;
    return bt - at;
  });
  return json(filtered);
}

export async function getPendingQuestionsList(): Promise<Response> {
  const kv = getLongTermKv();
  if (!kv || !kv.list) return json([]);
  const result = await kv.list({prefix: "meta:"});
  const slice = result.keys.slice(0, 50);
  const list = await Promise.all(slice.map(async (key) => {
    const chatId = key.name.replace("meta:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const meta = JSON.parse(raw) as UserMeta;
      const questions = meta.pendingQuestions || [];
      if (questions.length === 0) return null;
      return {chatId, contactName: chatId, questions: questions.map((q: string) => ({question: q, addedAt: null}))};
    } catch { return null; }
  }));
  const filtered = list.filter(Boolean).sort((a, b) => b!.questions.length - a!.questions.length);
  return json(filtered);
}

export async function getReplyQueue(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json([]);
  const result = await kv.list({prefix: "pending:"});
  const now = Date.now();
  const slice = result.keys.slice(0, 50);
  const list = await Promise.all(slice.map(async (key) => {
    const chatId = key.name.replace("pending:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const reply = JSON.parse(raw) as {replyAfter: number; isUrgent?: boolean; text?: string; senderName?: string};
      return {chatId, contactName: reply.senderName || chatId, scheduledAt: new Date(reply.replyAfter).toISOString(), msUntilDue: reply.replyAfter - now, isUrgent: reply.isUrgent || false, messagePreview: (reply.text || "").slice(0, 60)};
    } catch { return null; }
  }));
  return json(list.filter(Boolean));
}

export async function getHealthStatus(): Promise<Response> {
  const weekly = await getWeeklyAccumulator();
  const kvWritesEstimated = weekly.totalMessages * 3 + weekly.brainRunCount * 2;
  const kvWritePercent = Math.min(Math.round((kvWritesEstimated / 1000) * 100), 100);
  const convKv = getConversationsKv();
  let modelCooldowns: Array<{model: string; coolingDown: boolean; expiresAt: string | null}> = [];
  if (convKv && convKv.list) {
    try {
      const cdResult = await convKv.list({prefix: "cooldown:"});
      const now = Date.now();
      modelCooldowns = await Promise.all(cdResult.keys.slice(0, 20).map(async (key) => {
        const model = key.name.replace("cooldown:", "");
        const raw = await convKv.get(key.name);
        const until = raw ? Number(raw) || 0 : 0;
        return {model, coolingDown: until > now, expiresAt: until > now ? new Date(until).toISOString() : null};
      }));
    } catch { /* ignore */ }
  }
  return json({
    kvWritesEstimated, kvWriteLimit: 1000, kvWritePercent,
    modelCooldowns, modelsInCooldown: modelCooldowns.filter((m) => m.coolingDown).length,
    lastDailyCronAt: weekly.lastDailyCronAt, lastWeeklyCronAt: weekly.lastWeeklyCronAt,
    brainErrorCount: weekly.brainErrorCount, groqParseFailures: weekly.groqParseFailures,
    botUptime: "Worker has no persistent uptime — N/A",
  });
}

export async function handleConversationAction(chatId: string, body: string): Promise<Response> {
  try {
    const {action, pauseMinutes} = JSON.parse(body) as {action?: string; pauseMinutes?: number};
    switch (action) {
      case "pause": {
        const minutes = Math.min(Math.max(pauseMinutes || 60, 1), 1440);
        const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        await setPausedUntil(chatId, until);
        return json({success: true, message: `Chat paused for ${minutes} minutes`});
      }
      case "unpause": {
        await clearPausedUntil(chatId);
        return json({success: true, message: "Chat unpaused"});
      }
      case "promote": {
        const stages: UserMeta["relationshipStage"][] = ["stranger", "acquaintance", "warm_lead", "regular"];
        const meta = await getUserMeta(chatId);
        const idx = stages.indexOf(meta.relationshipStage);
        if (idx >= stages.length - 1) return json({success: false, error: "Already at highest stage"});
        await updateUserMeta(chatId, {relationshipStage: stages[idx + 1]});
        return json({success: true, message: `Promoted to ${stages[idx + 1]}`});
      }
      case "force_brain": {
        runBrainAnalysis(Number(chatId), "Dashboard", true).catch((err) => console.error("[Dashboard] Brain analysis error:", err));
        return json({success: true, message: "Brain analysis triggered"});
      }
      case "forget_confirm": {
        await deleteLongTermKey(`meta:${chatId}`);
        await deleteLongTermKey(`memory:${chatId}`);
        await deleteConversationsKey(`brain:summary:${chatId}`);
        await deleteConversationsKey(`persona:${chatId}`);
        await deleteConversationsKey(`brain:output:${chatId}`);
        return json({success: true, message: `Chat ${chatId} data wiped`});
      }
      default:
        return json({success: false, error: `Unknown action: ${action}`}, 400);
    }
  } catch (e) {
    return json({success: false, error: String(e)}, 500);
  }
}
