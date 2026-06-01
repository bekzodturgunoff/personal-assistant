import {getUsageStats, resetUsageStats} from "./lib/usage-stats.js";
import {getGeminiModels, setGeminiModels, getGroqModels, setGroqModels, DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_CHAT_MODELS, DEFAULT_GROQ_JSON_MODELS} from "./lib/model-config.js";
import {getWeeklyAccumulator, saveWeeklyAccumulator, getUserMeta, getLongTermKv, getConversationsKv, getModelCooldownKv, deleteLongTermKey, deleteConversationsKey, setPausedUntil, clearPausedUntil, updateUserMeta} from "./lib/kv-store.js";
import type {UserMeta} from "./lib/kv-store.js";
import {getPersona} from "./persona-memory.js";
import {getConversationSummary, getBrainOutput, runBrainAnalysis} from "./brain/brain.js";
import {getBotSettings, saveBotSettings, getDefaultSettings, getPersonaHistory, appendPersonaHistory, containsAntiPattern, generateCommandId} from "./lib/bot-settings.js";
import type {BotSettings, BotCommandEntry} from "./lib/bot-settings.js";
import type {BrainOutput} from "./brain/types.js";
import {BRAIN_OUTPUT_DEFAULTS} from "./brain/types.js";
import {callGeminiWithFallback} from "./lib/gemini.js";
import {buildIdentityPrompt} from "./lib/bot-settings.js";
import {getFullHistory, addMessage} from "./conversation-memory.js";
import {config} from "./config.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"},
  });
}

async function getContactName(chatId: string): Promise<string> {
  try {
    const persona = await getPersona(Number(chatId));
    if (persona && persona.messageCount > 0) return `Chat ${chatId}`;
  } catch { /* ignore */ }
  return chatId;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export async function handleDashboardApi(pathname: string, method: string, body: string | null): Promise<Response | null> {
  try {
    // ── Existing endpoints ──
    if (pathname === "/api/dashboard/data" && method === "GET") {
      return getDashboardData();
    }
    if (pathname === "/api/dashboard/models/gemini" && method === "GET") {
      return json({models: await getGeminiModels()});
    }
    if (pathname === "/api/dashboard/models/gemini" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const {models} = JSON.parse(body) as {models?: string[]};
      if (!Array.isArray(models) || models.length === 0) return json({error: "models must be a non-empty array"}, 400);
      await setGeminiModels(models);
      return json({ok: true, models});
    }
    if (pathname === "/api/dashboard/models/groq" && method === "GET") {
      return json(await getGroqModels());
    }
    if (pathname === "/api/dashboard/models/groq" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const config = JSON.parse(body) as {chatModels?: string[]; jsonModels?: string[]};
      if (!Array.isArray(config.chatModels) || config.chatModels.length === 0) return json({error: "chatModels must be a non-empty array"}, 400);
      if (!Array.isArray(config.jsonModels) || config.jsonModels.length === 0) return json({error: "jsonModels must be a non-empty array"}, 400);
      await setGroqModels({chatModels: config.chatModels, jsonModels: config.jsonModels});
      return json({ok: true, chatModels: config.chatModels, jsonModels: config.jsonModels});
    }
    if (pathname === "/api/dashboard/usage/reset" && method === "POST") {
      await resetUsageStats();
      return json({ok: true});
    }
    if (pathname === "/api/dashboard/models/gemini/reset" && method === "POST") {
      await setGeminiModels(DEFAULT_GEMINI_MODELS);
      return json({ok: true, models: DEFAULT_GEMINI_MODELS});
    }
    if (pathname === "/api/dashboard/models/groq/reset" && method === "POST") {
      await setGroqModels({chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS});
      return json({ok: true, chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS});
    }

    // ── New: GET /api/dashboard/conversations ──
    if (pathname === "/api/dashboard/conversations" && method === "GET") {
      return getConversationsList();
    }

    // ── New: GET /api/dashboard/pending ──
    if (pathname === "/api/dashboard/pending" && method === "GET") {
      return getPendingQuestionsList();
    }

    // ── New: GET /api/dashboard/queue ──
    if (pathname === "/api/dashboard/queue" && method === "GET") {
      return getReplyQueue();
    }

    // ── New: GET /api/dashboard/health ──
    if (pathname === "/api/dashboard/health" && method === "GET") {
      return getHealthStatus();
    }

    // ── New: POST /api/dashboard/conversations/:chatId/action ──
    const actionMatch = pathname.match(/^\/api\/dashboard\/conversations\/(\d+)\/action$/);
    if (actionMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationAction(actionMatch[1], body);
    }

    // ── Bot settings ──
    if (pathname === "/api/dashboard/settings" && method === "GET") {
      const settings = await getBotSettings();
      return json(settings);
    }

    if (pathname === "/api/dashboard/settings" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const partial = JSON.parse(body) as Partial<BotSettings>;
      const current = await getBotSettings();
      const merged = {...current, ...partial};
      await saveBotSettings(merged);
      return json({ok: true, settings: merged});
    }

    // ── Get model cooldowns ──
    if (pathname === "/api/dashboard/models/cooldowns" && method === "GET") {
      const convKv = getConversationsKv();
      if (!convKv || !convKv.list) return json([]);
      const cdResult = await convKv.list({prefix: "cooldown:"});
      const now = Date.now();
      const list = await Promise.all(cdResult.keys.map(async (key) => {
        const model = key.name.replace("cooldown:", "");
        const raw = await convKv.get(key.name);
        const until = raw ? Number(raw) || 0 : 0;
        return {model, coolingDown: until > now, expiresAt: until > now ? until : null};
      }));
      return json(list);
    }

    // ── Clear model cooldown ──
    const clearCdMatch = pathname.match(/^\/api\/dashboard\/models\/cooldown\/(.+)$/);
    if (clearCdMatch && method === "POST") {
      const convKv = getConversationsKv();
      if (!convKv) return json({error: "KV not available"}, 500);
      await convKv.delete?.(`cooldown:${clearCdMatch[1]}`);
      return json({ok: true});
    }

    if (pathname === "/api/dashboard/settings/reset" && method === "POST") {
      await saveBotSettings(getDefaultSettings());
      return json({ok: true});
    }

    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

// ── New: Non-dashboard API routes (called from worker.ts) ──

export async function handleNonDashboardApi(pathname: string, method: string, body: string | null): Promise<Response | null> {
  try {
    // ── Conversations ──
    if (pathname === "/api/conversations" && method === "GET") {
      return getFullConversationsList();
    }
    const convChatMatch = pathname.match(/^\/api\/conversations\/(\d+)$/);
    if (convChatMatch && method === "GET") {
      return getConversationDetail(convChatMatch[1]);
    }
    const convMuteMatch = pathname.match(/^\/api\/conversations\/(.+)\/mute$/);
    if (convMuteMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationMute(convMuteMatch[1], body);
    }
    if (convMuteMatch && method === "GET") {
      return handleConversationMuteGet(convMuteMatch[1]);
    }
    const convInjectMatch = pathname.match(/^\/api\/conversations\/(\d+)\/inject$/);
    if (convInjectMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationInject(convInjectMatch[1], body);
    }
    const convCancelMatch = pathname.match(/^\/api\/conversations\/(\d+)\/cancel-pending$/);
    if (convCancelMatch && method === "POST") {
      return handleCancelPending(convCancelMatch[1]);
    }
    const convBrainResetMatch = pathname.match(/^\/api\/conversations\/(\d+)\/brain-reset$/);
    if (convBrainResetMatch && method === "POST") {
      return handleConversationBrainReset(convBrainResetMatch[1]);
    }
    const convBrainRunMatch = pathname.match(/^\/api\/conversations\/(\d+)\/brain-run$/);
    if (convBrainRunMatch && method === "POST") {
      return handleConversationBrainRun(convBrainRunMatch[1]);
    }
    const convMetaMatch = pathname.match(/^\/api\/conversations\/(\d+)\/meta$/);
    if (convMetaMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationMetaPatch(convMetaMatch[1], body);
    }

    // ── Commands ──
    if (pathname === "/api/commands/generate" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandGenerate(body);
    }
    if (pathname === "/api/commands/test" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandTest(body);
    }
    if (pathname === "/api/commands" && method === "GET") {
      const settings = await getBotSettings();
      return json(settings.commands);
    }
    if (pathname === "/api/commands" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandCreate(body);
    }
    const cmdPatchMatch = pathname.match(/^\/api\/commands\/([a-zA-Z0-9]+)$/);
    if (cmdPatchMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandUpdate(cmdPatchMatch[1], body);
    }
    if (cmdPatchMatch && method === "DELETE") {
      return handleCommandDelete(cmdPatchMatch[1]);
    }
    const cmdRegisterMatch = pathname.match(/^\/api\/commands\/([a-zA-Z0-9]+)\/register$/);
    if (cmdRegisterMatch && method === "POST") {
      return handleCommandRegister();
    }

    // ── Brain ──
    if (pathname === "/api/brain/overview" && method === "GET") {
      return getBrainOverview();
    }
    if (pathname === "/api/brain/low-confidence" && method === "GET") {
      return getBrainLowConfidence();
    }
    const brainChatMatch = pathname.match(/^\/api\/brain\/(\d+)$/);
    if (brainChatMatch && method === "GET") {
      return getBrainForChat(brainChatMatch[1]);
    }
    if (brainChatMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleBrainPatch(brainChatMatch[1], body);
    }
    if (brainChatMatch && method === "DELETE") {
      return handleBrainDelete(brainChatMatch[1]);
    }
    const brainRunMatch = pathname.match(/^\/api\/brain\/(\d+)\/run$/);
    if (brainRunMatch && method === "POST") {
      return handleConversationBrainRun(brainRunMatch[1]);
    }

    // ── Persona ──
    if (pathname === "/api/persona/test" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handlePersonaTest(body);
    }
    if (pathname === "/api/persona/history" && method === "GET") {
      const history = await getPersonaHistory();
      return json(history);
    }
    const personaRevertMatch = pathname.match(/^\/api\/persona\/revert\/(\d+)$/);
    if (personaRevertMatch && method === "POST") {
      return handlePersonaRevert(personaRevertMatch[1]);
    }

    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

async function getFullConversationsList(): Promise<Response> {
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

async function getConversationDetail(chatId: string): Promise<Response> {
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

async function handleConversationMuteGet(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({muted: false});
  const raw = await kv.get(`muted:${chatId}`);
  return json({muted: raw === "true"});
}

async function handleConversationMute(chatId: string, body: string): Promise<Response> {
  const {muted} = JSON.parse(body) as {muted?: boolean};
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await kv.put(`muted:${chatId}`, muted ? "true" : "false");
  return json({ok: true});
}

async function handleConversationInject(chatId: string, body: string): Promise<Response> {
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

async function handleCancelPending(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const raw = await kv.get(`pending:${chatId}`);
  if (raw) {
    await kv.delete?.(`pending:${chatId}`);
    return json({ok: true, cancelled: 1});
  }
  return json({ok: true, cancelled: 0});
}

async function handleConversationBrainReset(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await Promise.all([
    kv.delete?.(`brain:output:${chatId}`),
    kv.delete?.(`brain:summary:${chatId}`),
  ]);
  return json({ok: true});
}

async function handleConversationBrainRun(chatId: string): Promise<Response> {
  await runBrainAnalysis(parseInt(chatId, 10), "Dashboard", true);
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const brainRaw = await kv.get(`brain:output:${chatId}`);
  const output = brainRaw ? JSON.parse(brainRaw) : null;
  return json({ok: true, output});
}

async function handleConversationMetaPatch(chatId: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<UserMeta>;
  await updateUserMeta(chatId, patch);
  return json({ok: true});
}

// ── Command handlers ──

async function handleCommandGenerate(body: string): Promise<Response> {
  const {name, description, instruction} = JSON.parse(body) as {name?: string; description?: string; instruction?: string};
  if (!name || !description || !instruction) return json({error: "name, description, instruction required"}, 400);
  const metaPrompt = `You are building a Telegram bot command handler. The command is /${name}.
Description: ${description}
The owner wants this command to: ${instruction}

The bot has access to:
- Full conversation history for all contacts (KV: chat:{id})
- Brain analysis output per contact (KV: brain:output:{id})
- UserMeta per contact (KV: meta:{id})
- Long-term memory per contact (KV: memory:{id})
- Weekly analytics accumulator (KV: analytics:current)
- Task list (KV: tasks:{user_id})

Generate a complete system prompt that this command will use when triggered.
The prompt should tell the AI exactly what data to retrieve, how to process it,
and what format to reply in. Be specific and concrete.
Return only the system prompt text, nothing else.`;
  try {
    const generatedPrompt = await callGeminiWithFallback(metaPrompt);
    return json({generatedPrompt});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

async function handleCommandTest(body: string): Promise<Response> {
  const {generatedPrompt, name} = JSON.parse(body) as {generatedPrompt?: string; name?: string};
  if (!generatedPrompt) return json({error: "generatedPrompt required"}, 400);
  const kv = getConversationsKv();
  let sampleContext = "No recent conversations.";
  if (kv && kv.list) {
    try {
      const keys = await kv.list({prefix: "chat:"});
      const samples = await Promise.all(keys.keys.slice(0, 3).map(async (k) => {
        const raw = await kv.get(k.name);
        if (!raw) return "";
        const entries = JSON.parse(raw).slice(-5);
        return entries.map((e: {role: string; text: string}) => `${e.role}: ${e.text}`).join("\n");
      }));
      sampleContext = samples.filter(Boolean).join("\n\n---\n\n") || sampleContext;
    } catch {}
  }
  const prompt = `${generatedPrompt}\n\nRecent conversation context:\n${sampleContext}\n\nRespond as the bot for command /${name || "test"}.`;
  try {
    const output = await callGeminiWithFallback(prompt);
    return json({output});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

async function handleCommandCreate(body: string): Promise<Response> {
  const data = JSON.parse(body) as Omit<BotCommandEntry, "id" | "createdAt">;
  const id = generateCommandId();
  const cmd: BotCommandEntry = {...data, id, createdAt: Date.now()};
  const settings = await getBotSettings();
  settings.commands.push(cmd);
  await saveBotSettings(settings);
  return json({ok: true, id});
}

async function handleCommandUpdate(id: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<BotCommandEntry>;
  const settings = await getBotSettings();
  const idx = settings.commands.findIndex((c) => c.id === id);
  if (idx === -1) return json({error: "not found"}, 404);
  settings.commands[idx] = {...settings.commands[idx], ...patch};
  await saveBotSettings(settings);
  return json({ok: true});
}

async function handleCommandDelete(id: string): Promise<Response> {
  const settings = await getBotSettings();
  settings.commands = settings.commands.filter((c) => c.id !== id);
  await saveBotSettings(settings);
  return json({ok: true});
}

async function handleCommandRegister(): Promise<Response> {
  const settings = await getBotSettings();
  const enabled = settings.commands.filter((c) => c.enabled);
  const cmds = enabled.map((c) => ({command: c.name, description: c.description}));
  const tgUrl = `https://api.telegram.org/bot${config.telegramBotToken}/setMyCommands`;
  const res = await fetch(tgUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({commands: cmds}),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text();
    return json({error: `Telegram API: ${err}`}, 500);
  }
  return json({ok: true});
}

// ── Brain handlers ──

async function getBrainOverview(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json({totalAnalyzed: 0, avgConfidence: 0, intentBreakdown: {}, sentimentBreakdown: {}, languageBreakdown: {}, contacts: []});
  const result = await kv.list({prefix: "brain:output:"});
  const contacts = await Promise.all(result.keys.map(async (key) => {
    const chatId = key.name.replace("brain:output:", "");
    const raw = await kv.get(key.name);
    if (!raw) return null;
    try {
      const output = JSON.parse(raw) as BrainOutput;
      return {chatId, output};
    } catch { return null; }
  }));
  const valid = contacts.filter(Boolean).sort((a, b) => (b!.output.lastUpdated || 0) - (a!.output.lastUpdated || 0));
  const totalAnalyzed = valid.length;
  const avgConfidence = totalAnalyzed > 0 ? valid.reduce((s, c) => s + (c!.output.lastConfidence || 1), 0) / totalAnalyzed : 0;
  const intentBreakdown: Record<string, number> = {};
  const sentimentBreakdown: Record<string, number> = {};
  const languageBreakdown: Record<string, number> = {};
  for (const c of valid) {
    const i = c!.output.intent;
    if (i) intentBreakdown[i] = (intentBreakdown[i] || 0) + 1;
    const s = c!.output.sentiment;
    if (s) sentimentBreakdown[s] = (sentimentBreakdown[s] || 0) + 1;
    const l = c!.output.detectedLanguage;
    if (l) languageBreakdown[l] = (languageBreakdown[l] || 0) + 1;
  }
  return json({totalAnalyzed, avgConfidence, intentBreakdown, sentimentBreakdown, languageBreakdown, contacts: valid});
}

async function getBrainLowConfidence(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json([]);
  const settings = await getBotSettings();
  const threshold = settings.confidence.fallbackThreshold;
  const result = await kv.list({prefix: "brain:output:"});
  const low = await Promise.all(result.keys.map(async (key) => {
    const chatId = key.name.replace("brain:output:", "");
    const raw = await kv.get(key.name);
    if (!raw) return null;
    try {
      const output = JSON.parse(raw) as BrainOutput;
      const conf = output.lastConfidence ?? 1;
      if (conf >= threshold) return null;
      return {chatId, lastConfidence: conf, lastMessage: "", personaNotes: output.persona_notes || ""};
    } catch { return null; }
  }));
  const filtered = low.filter(Boolean).sort((a, b) => (a!.lastConfidence || 0) - (b!.lastConfidence || 0));
  return json(filtered);
}

async function getBrainForChat(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const [raw, summaryRaw] = await Promise.all([
    kv.get(`brain:output:${chatId}`),
    kv.get(`brain:summary:${chatId}`),
  ]);
  const output = raw ? JSON.parse(raw) : null;
  const summary = summaryRaw || "";
  return json({output, summary});
}

async function handleBrainPatch(chatId: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<BrainOutput>;
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const raw = await kv.get(`brain:output:${chatId}`);
  const existing = raw ? JSON.parse(raw) as BrainOutput : {...BRAIN_OUTPUT_DEFAULTS, lastUpdated: Date.now(), facts: [], is_returning: false};
  const merged = {...existing, ...patch};
  await kv.put(`brain:output:${chatId}`, JSON.stringify(merged));
  return json({ok: true});
}

async function handleBrainDelete(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await Promise.all([
    kv.delete?.(`brain:output:${chatId}`),
    kv.delete?.(`brain:summary:${chatId}`),
  ]);
  return json({ok: true});
}

// ── Persona handlers ──

async function handlePersonaTest(body: string): Promise<Response> {
  const {message, language} = JSON.parse(body) as {message?: string; language?: string};
  if (!message) return json({error: "message required"}, 400);
  const settings = await getBotSettings();
  const prompt = `${await buildIdentityPrompt(settings)}

Current user message (in ${language || "uz"}):
${message}

Respond with a JSON object:
{
  "text": "your natural reply",
  "confidence": 0.0-1.0,
  "is_factual_claim": true/false
}`;
  try {
    const raw = await callGeminiWithFallback(prompt);
    const cleaned = raw.replace(/```(json)?/g, "").trim();
    let replyText = raw;
    let confidence = 1.0;
    try {
      const parsed = JSON.parse(cleaned) as {text?: string; confidence?: number};
      if (parsed.text) replyText = parsed.text;
      if (typeof parsed.confidence === "number") confidence = parsed.confidence;
    } catch {}
    const detectedAntiPatterns = containsAntiPattern(replyText, settings.neverSay);
    return json({reply: replyText, confidence, detectedAntiPatterns});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

async function handlePersonaRevert(savedAt: string): Promise<Response> {
  const history = await getPersonaHistory();
  const entry = history.find((h) => h.savedAt === parseInt(savedAt, 10));
  if (!entry) return json({error: "snapshot not found"}, 404);
  await saveBotSettings(entry.snapshot);
  return json({ok: true});
}

// ── Existing: conversations list ──
async function getConversationsList(): Promise<Response> {
  const kv = getLongTermKv();
  if (!kv || !kv.list) return json([]);

  const result = await kv.list({prefix: "meta:"});
  const limit = 50;
  const slice = result.keys.slice(0, limit);

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
        if (pausedRaw) {
          isPaused = Date.now() < new Date(pausedRaw).getTime();
        }
      } catch { /* ignore */ }

      return {
        chatId,
        contactName: meta.businessConnectionId ? chatId : chatId,
        relationshipStage: meta.relationshipStage,
        messageCount: meta.messageCount,
        lastMessageAt: meta.lastMessageTimestamp ? new Date(meta.lastMessageTimestamp).toISOString() : null,
        daysSinceLastMessage: meta.lastMessageTimestamp ? Math.floor((Date.now() - meta.lastMessageTimestamp) / 86400000) : null,
        pendingQuestionsCount: (meta.pendingQuestions || []).length,
        lastIntent: meta.lastIntent,
        lastSentiment: meta.lastSentiment,
        lastUrgency: meta.lastUrgency,
        isPaused,
        brainSummaryShort,
        lowConfCount: meta.lowConfCount || 0,
      };
    } catch {
      return null;
    }
  }));

  const filtered = list.filter(Boolean).sort((a, b) => {
    const at = a!.lastMessageAt ? new Date(a!.lastMessageAt).getTime() : 0;
    const bt = b!.lastMessageAt ? new Date(b!.lastMessageAt).getTime() : 0;
    return bt - at;
  });

  return json(filtered);
}

// ── New: pending questions ──
async function getPendingQuestionsList(): Promise<Response> {
  const kv = getLongTermKv();
  if (!kv || !kv.list) return json([]);

  const result = await kv.list({prefix: "meta:"});
  const limit = 50;
  const slice = result.keys.slice(0, limit);

  const list = await Promise.all(slice.map(async (key) => {
    const chatId = key.name.replace("meta:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const meta = JSON.parse(raw) as UserMeta;
      const questions = meta.pendingQuestions || [];
      if (questions.length === 0) return null;

      return {
        chatId,
        contactName: chatId,
        questions: questions.map((q: string) => ({ question: q, addedAt: null })),
      };
    } catch {
      return null;
    }
  }));

  const filtered = list.filter(Boolean).sort((a, b) => b!.questions.length - a!.questions.length);
  return json(filtered);
}

// ── New: reply queue ──
async function getReplyQueue(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json([]);

  const result = await kv.list({prefix: "pending:"});
  const now = Date.now();
  const limit = 50;
  const slice = result.keys.slice(0, limit);

  const list = await Promise.all(slice.map(async (key) => {
    const chatId = key.name.replace("pending:", "");
    try {
      const raw = await kv.get(key.name);
      if (!raw) return null;
      const reply = JSON.parse(raw) as { replyAfter: number; isUrgent?: boolean; text?: string; senderName?: string };
      return {
        chatId,
        contactName: reply.senderName || chatId,
        scheduledAt: new Date(reply.replyAfter).toISOString(),
        msUntilDue: reply.replyAfter - now,
        isUrgent: reply.isUrgent || false,
        messagePreview: (reply.text || "").slice(0, 60),
      };
    } catch {
      return null;
    }
  }));

  return json(list.filter(Boolean));
}

// ── New: health status ──
async function getHealthStatus(): Promise<Response> {
  const weekly = await getWeeklyAccumulator();
  const kvWritesEstimated = weekly.totalMessages * 3 + weekly.brainRunCount * 2;
  const kvWritePercent = Math.min(Math.round((kvWritesEstimated / 1000) * 100), 100);

  // Read model cooldowns from CONVERSATIONS KV
  const convKv = getConversationsKv();
  let modelCooldowns: Array<{ model: string; coolingDown: boolean; expiresAt: string | null }> = [];
  if (convKv && convKv.list) {
    try {
      const cdResult = await convKv.list({prefix: "cooldown:"});
      const now = Date.now();
      modelCooldowns = await Promise.all(cdResult.keys.slice(0, 20).map(async (key) => {
        const model = key.name.replace("cooldown:", "");
        const raw = await convKv.get(key.name);
        const until = raw ? Number(raw) || 0 : 0;
        return {
          model,
          coolingDown: until > now,
          expiresAt: until > now ? new Date(until).toISOString() : null,
        };
      }));
    } catch { /* ignore */ }
  }

  const modelsInCooldown = modelCooldowns.filter((m) => m.coolingDown).length;

  return json({
    kvWritesEstimated,
    kvWriteLimit: 1000,
    kvWritePercent,
    modelCooldowns,
    modelsInCooldown,
    lastDailyCronAt: weekly.lastDailyCronAt,
    lastWeeklyCronAt: weekly.lastWeeklyCronAt,
    brainErrorCount: weekly.brainErrorCount,
    groqParseFailures: weekly.groqParseFailures,
    botUptime: "Worker has no persistent uptime — N/A",
  });
}

// ── New: conversation action ──
async function handleConversationAction(chatId: string, body: string): Promise<Response> {
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
        if (idx >= stages.length - 1) {
          return json({success: false, error: "Already at highest stage"});
        }
        const newStage = stages[idx + 1];
        const {updateUserMeta} = await import("./lib/kv-store.js");
        await updateUserMeta(chatId, {relationshipStage: newStage});
        return json({success: true, message: `Promoted to ${newStage}`});
      }
      case "force_brain": {
        runBrainAnalysis(Number(chatId), "Dashboard", true).catch((err) =>
          console.error(`[Dashboard] Brain analysis error:`, err),
        );
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

// ── Extended dashboard data ──
async function getDashboardData(): Promise<Response> {
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

  const modelsInCooldown = 0; // will be fetched by health endpoint

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
      modelsInCooldown,
    },
  });
}

export function renderDashboardPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Bot Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; touch-action: manipulation; -webkit-text-size-adjust: 100%; }
  .container { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 24px; color: #f8fafc; }
  h2 { font-size: 1.1rem; margin-bottom: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat { background: #0f172a; border-radius: 8px; padding: 12px; }
  .stat-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 1.5rem; font-weight: 700; margin-top: 4px; }
  .stat-value.green { color: #4ade80; }
  .stat-value.blue { color: #60a5fa; }
  .stat-value.yellow { color: #facc15; }
  .stat-value.red { color: #f87171; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; padding: 8px 8px 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #334155; }
  td { padding: 8px 8px 8px 0; border-bottom: 1px solid #1e293b; }
  tr:last-child td { border-bottom: none; }
  .model-tag { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; font-family: monospace; }
  .model-tag.primary { border-color: #3b82f6; color: #93c5fd; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: none; font-size: 0.875rem; cursor: pointer; background: #334155; color: #e2e8f0; transition: background 0.15s; }
  .btn:hover { background: #475569; }
  .btn.primary { background: #3b82f6; color: white; }
  .btn.primary:hover { background: #2563eb; }
  .btn.danger { background: #dc2626; color: white; }
  .btn.danger:hover { background: #b91c1c; }
  .btn.sm { padding: 4px 10px; font-size: 0.75rem; }
  .input-group { display: flex; gap: 8px; margin-bottom: 8px; }
  input[type="text"] { flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #e2e8f0; font-size: 0.875rem; font-family: monospace; }
  input[type="text"]:focus { outline: none; border-color: #3b82f6; }
  input[type="password"] { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #e2e8f0; font-size: 0.875rem; width: 100%; }
  input[type="password"]:focus { outline: none; border-color: #3b82f6; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: #166534; color: #bbf7d0; padding: 12px 20px; border-radius: 8px; font-size: 0.875rem; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.error { background: #991b1b; color: #fca5a5; }
  .tab-bar { display: flex; gap: 4px; margin-bottom: 20px; background: #1e293b; border-radius: 8px; padding: 4px; }
  .tab { padding: 8px 16px; border-radius: 6px; border: none; background: transparent; color: #94a3b8; cursor: pointer; font-size: 0.875rem; }
  .tab.active { background: #3b82f6; color: white; }
  .tab:hover:not(.active) { background: #334155; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .login-screen { display: flex; min-height: 80vh; align-items: center; justify-content: center; }
  .login-box { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; width: 100%; max-width: 360px; }
  .login-box h2 { margin-bottom: 16px; }
  .login-box .input-group { margin-bottom: 12px; }
  .login-box .error { color: #f87171; font-size: 0.8rem; margin-top: 8px; display: none; }
  .dashboard { display: none; }
  .loading { color: #64748b; font-style: italic; padding: 20px; text-align: center; }
  @media (max-width: 768px) {
  body { padding: 12px; }
  .container { padding: 0; }
  .grid { grid-template-columns: 1fr; }
  .card { padding: 14px; }
  .tab-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; gap: 2px; }
  .tab { white-space: nowrap; padding: 10px 12px; font-size: 0.8rem; }
  .card-header { flex-wrap: wrap; gap: 8px; }
  input, select, textarea, button { font-size: 16px !important; }
  .login-box { max-width: 100%; margin: 0 8px; }
  [style*="grid-template-columns:"] { grid-template-columns: 1fr !important; }
  .input-group { flex-wrap: wrap; }
  .input-group input { flex: 1 1 100%; }
  .btn { min-height: 44px; justify-content: center; }
  .stat-value { font-size: 1.25rem; }
  h1 { font-size: 1.25rem; }
  table { font-size: 0.75rem; }
  th, td { padding: 6px 6px 6px 0; }
}
</style>
</head>
<body>
<div id="login-screen" class="login-screen">
  <div class="login-box">
    <h2>Bot Dashboard</h2>
    <p style="color:#94a3b8;font-size:0.875rem;margin-bottom:16px;">Sign in</p>
    <div class="input-group" style="flex-direction:column;gap:8px;">
      <input type="text" id="username-input" placeholder="Username" onkeydown="if(event.key==='Enter')document.getElementById('password-input').focus()" autocomplete="username" />
      <input type="password" id="password-input" placeholder="Password" onkeydown="if(event.key==='Enter')login()" autocomplete="current-password" />
    </div>
    <button class="btn primary" onclick="login()" style="width:100%;justify-content:center;">Sign in</button>
    <div id="login-error" class="error">Invalid credentials</div>
  </div>
</div>

<div id="dashboard" class="dashboard">
  <div class="card-header">
    <h1>Bot Dashboard</h1>
    <div style="display:flex;align-items:center;gap:12px;">
      <span id="month-display" style="color:#64748b;font-size:0.875rem;"></span>
      <button class="btn sm" onclick="sessionStorage.removeItem('dash_token');location.reload()" title="Lock">🔒</button>
    </div>
  </div>

  <div class="tab-bar" id="tab-bar">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="conversations">Conversations</button>
    <button class="tab" data-tab="brain">Brain</button>
    <button class="tab" data-tab="commands">Commands</button>
    <button class="tab" data-tab="persona">Persona</button>
    <button class="tab" data-tab="models">Models</button>
    <button class="tab" data-tab="usage">Usage</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>

  <div id="tab-overview" class="tab-content active">
    <div class="card" id="bot-status-card">
      <div class="card-header">
        <h2>Bot Status</h2>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <label style="position:relative;display:inline-block;width:60px;height:34px;">
          <input type="checkbox" id="bot-status-toggle" onchange="toggleBotStatus()" style="opacity:0;width:0;height:0;">
          <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#475569;border-radius:34px;transition:0.3s;" id="bot-status-slider"></span>
        </label>
        <span id="bot-status-label" style="font-size:1.1rem;font-weight:600;">Active</span>
        <span id="bot-status-timestamp" style="color:#64748b;font-size:0.8rem;"></span>
      </div>
    </div>

    <div class="card">
      <h2>Weekly Stats</h2>
      <div class="grid" id="weekly-stats"></div>
    </div>

    <div class="card">
      <h2>Recent Activity</h2>
      <div id="recent-activity" style="max-height:300px;overflow-y:auto;"></div>
    </div>

    <div class="card" id="flagged-contacts-card" style="display:none;">
      <div class="card-header">
        <h2>Flagged Contacts</h2>
      </div>
      <div id="flagged-contacts-list"></div>
    </div>

    <div class="card">
      <h2>AI Usage (Monthly)</h2>
      <div class="grid" id="monthly-usage"></div>
    </div>

    <div class="card">
      <h2>Model Status</h2>
      <div id="model-status"></div>
    </div>
  </div>

  <div id="tab-conversations" class="tab-content">
    <div class="card" style="padding:0;">
      <div style="display:flex;gap:8px;padding:16px;border-bottom:1px solid #334155;flex-wrap:wrap;">
        <input type="text" id="conv-search" placeholder="Search contacts..." oninput="renderConversations()" style="flex:2;min-width:150px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;" />
        <select id="conv-filter" onchange="renderConversations()" style="flex:1;min-width:120px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;">
          <option value="all">All</option>
          <option value="pending">Pending reply</option>
          <option value="muted">Muted</option>
          <option value="flagged">Flagged for handoff</option>
        </select>
        <button class="btn sm" onclick="loadConversations()">Refresh</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:0;">
        <div id="conv-list" style="max-height:600px;overflow-y:auto;border-right:1px solid #334155;padding:8px;"></div>
        <div id="conv-detail" style="padding:16px;max-height:600px;overflow-y:auto;">
          <p style="color:#64748b;text-align:center;margin-top:40px;">Select a contact to view details</p>
        </div>
      </div>
    </div>
  </div>

  <div id="tab-brain" class="tab-content">
    <div class="card">
      <div class="grid" id="brain-stats"></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Intent Breakdown</h2></div>
      <div id="brain-intent-breakdown"></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Sentiment Breakdown</h2></div>
      <div id="brain-sentiment-breakdown"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>Low Confidence Log</h2>
        <button class="btn sm" onclick="document.getElementById('brain-lowconf-section').style.display=document.getElementById('brain-lowconf-section').style.display==='none'?'block':'none'">Toggle</button>
      </div>
      <div id="brain-lowconf-section" style="display:none;">
        <table><thead><tr><th>Chat ID</th><th>Confidence</th><th>Notes</th><th>Action</th></tr></thead><tbody id="brain-lowconf-table"></tbody></table>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Contact Brain Editor</h2></div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <input type="text" id="brain-editor-chatid" placeholder="Enter chat ID..." style="flex:1;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;" />
        <button class="btn primary" onclick="loadBrainEditor()">Load</button>
      </div>
      <div id="brain-editor-fields"></div>
    </div>
  </div>

  <div id="tab-commands" class="tab-content">
    <div class="card" style="padding:0;">
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:0;">
        <div style="padding:16px;border-right:1px solid #334155;">
          <div class="card-header"><h2>Command List</h2></div>
          <button class="btn primary sm" onclick="startNewCommand()">+ New Command</button>
          <div id="command-list" style="margin-top:12px;"></div>
        </div>
        <div id="command-editor" style="padding:16px;">
          <p style="color:#64748b;text-align:center;margin-top:40px;">Create or edit a command</p>
        </div>
      </div>
    </div>
  </div>

  <div id="tab-persona" class="tab-content">
    <div class="card">
      <div class="card-header"><h2>Live Tester</h2></div>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <textarea id="persona-test-message" rows="2" placeholder="Send a test message..." style="flex:2;min-width:200px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
        <select id="persona-test-lang" style="flex:0;min-width:100px;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;">
          <option value="uz">Uzbek</option>
          <option value="ru">Russian</option>
          <option value="en">English</option>
          <option value="uz_ru_mix">Mixed</option>
        </select>
        <button class="btn primary" onclick="testPersona()">Test</button>
      </div>
      <div id="persona-test-result" style="display:none;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:12px;margin-top:8px;">
        <div id="persona-test-reply"></div>
        <div id="persona-test-confidence" style="margin-top:4px;"></div>
        <div id="persona-test-antipatterns" style="margin-top:4px;color:#f87171;"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Time Personality</h2></div>
      <div id="time-personality-editor"></div>
    </div>
    <div class="card">
      <div class="card-header"><h2>Relationship Stages</h2></div>
      <div id="relationship-stage-editor"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>Version History</h2>
        <button class="btn sm" onclick="loadPersonaHistory()">Refresh</button>
      </div>
      <div id="persona-history-list"></div>
    </div>
  </div>

  <div id="tab-models" class="tab-content">
    <div class="card">
      <div class="card-header">
        <h2>Gemini Models</h2>
        <div style="display:flex;gap:8px;">
          <button class="btn sm" onclick="resetGeminiModels()">Reset</button>
        </div>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">First available model is used. On quota error, falls through to next. Cooldown lasts 24h.</p>
      <div id="gemini-model-list"></div>
      <div class="input-group">
        <input type="text" id="gemini-model-input" placeholder="Add model name..." />
        <button class="btn primary sm" onclick="addGeminiModel()">+ Add</button>
      </div>
      <button class="btn primary" onclick="saveGeminiModels()">Save Changes</button>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Groq Models</h2>
        <div style="display:flex;gap:8px;">
          <button class="btn sm" onclick="resetGroqModels()">Reset</button>
        </div>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">Used for brain analysis (background conversation summarization).</p>
      <h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:8px;">Chat Models</h3>
      <div id="groq-chat-model-list"></div>
      <div class="input-group">
        <input type="text" id="groq-chat-input" placeholder="Add chat model..." />
        <button class="btn primary sm" onclick="addGroqChatModel()">+ Add</button>
      </div>
      <h3 style="font-size:0.9rem;color:#94a3b8;margin-top:16px;margin-bottom:8px;">JSON Models</h3>
      <div id="groq-json-model-list"></div>
      <div class="input-group">
        <input type="text" id="groq-json-input" placeholder="Add JSON model..." />
        <button class="btn primary sm" onclick="addGroqJsonModel()">+ Add</button>
      </div>
      <button class="btn primary" onclick="saveGroqModels()" style="margin-top:12px;">Save Changes</button>
    </div>
  </div>

  <div id="tab-usage" class="tab-content">
    <div class="card">
      <div class="card-header">
        <h2>Gemini — Model Breakdown</h2>
        <button class="btn danger sm" onclick="resetUsage()">Reset Month</button>
      </div>
      <table id="gemini-usage-table">
        <thead><tr><th>Model</th><th>Calls</th><th>Input Tokens</th><th>Output Tokens</th><th>Total</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="card">
      <h2>Groq — Model Breakdown</h2>
      <table id="groq-usage-table">
        <thead><tr><th>Model</th><th>Calls</th><th>Input Tokens</th><th>Output Tokens</th><th>Total</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <div id="tab-settings" class="tab-content">
    <div class="card">
      <div class="card-header">
        <h2>Bot Identity</h2>
        <button class="btn sm" onclick="resetSettings()">Reset to Defaults</button>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">Changes take effect within ~30 seconds (settings cache TTL).</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Bot Name</label>
          <input type="text" id="set-name" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Owner Name</label>
          <input type="text" id="set-owner" />
        </div>
      </div>
      <div style="margin-top:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Location</label>
        <input type="text" id="set-from" />
      </div>
      <div style="margin-top:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Work</label>
        <input type="text" id="set-work" />
      </div>
      <div style="margin-top:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Style</label>
        <input type="text" id="set-style" />
      </div>
      <div style="margin-top:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Languages (comma separated)</label>
        <input type="text" id="set-languages" />
      </div>
    </div>



    <div class="card">
      <div class="card-header">
        <h2>Absolute Rules</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">One rule per line. These shape the AI's behavior.</p>
      <textarea id="set-absolute-rules" rows="8" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Never Say (banned phrases)</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">One phrase per line. The AI will avoid these entirely.</p>
      <textarea id="set-never-say" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Behavior Rules</h2>
      </div>
      <textarea id="set-behavior-rules" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Fallback Rules</h2>
      </div>
      <textarea id="set-fallback-rules" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Contact Info (Business Mode)</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Contact (one per line)</label>
          <textarea id="set-contact" rows="3" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Business Tone</label>
          <input type="text" id="set-business-tone" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Reply Timing</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">Controls how long the bot waits before replying. All values in seconds unless noted.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Conversation gap (minutes)</label>
          <input type="number" id="set-rt-conversation-gap" min="1" max="1440" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">First reply delay (sec)</label>
          <input type="number" id="set-rt-first-delay" min="0" max="3600" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Slow replier delay (sec)</label>
          <input type="number" id="set-rt-slow-delay" min="0" max="3600" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Normal reply delay (sec)</label>
          <input type="number" id="set-rt-normal-delay" min="0" max="3600" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Slow threshold (sec)</label>
          <input type="number" id="set-rt-slow-threshold" min="0" max="3600" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Random extra max (sec)</label>
          <input type="number" id="set-rt-random-extra" min="0" max="600" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Confidence Scorer</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">When confidence is below threshold AND the AI made a factual claim, it falls back to a safe phrase.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Enabled</label>
          <select id="set-conf-enabled" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Fallback threshold (0.0-1.0)</label>
          <input type="number" id="set-conf-threshold" min="0" max="1" step="0.01" />
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Fallback phrases (one per line)</label>
        <textarea id="set-conf-phrases" rows="3" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Low Confidence Alerts</h2>
      </div>
      <div>
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Alert threshold (consecutive low-conf replies before owner notified)</label>
        <input type="number" id="set-lowconf-threshold" min="1" max="20" />
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Typing Simulation</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">ms per character</label>
          <input type="number" id="set-typing-mschar" min="0" max="500" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max typing duration (ms)</label>
          <input type="number" id="set-typing-maxms" min="0" max="30000" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>AI Response Limits</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max characters</label>
          <input type="number" id="set-max-chars" min="50" max="4000" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max sentences</label>
          <input type="number" id="set-max-sentences" min="1" max="20" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Brain Analysis</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Enabled</label>
          <select id="set-brain-enabled" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Analysis interval (every N user messages)</label>
          <input type="number" id="set-brain-interval" min="1" max="50" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>AI Fallback Messages</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">When AI calls completely fail, one of these is sent randomly.</p>
      <textarea id="set-ai-fallbacks" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Other</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Group reply cooldown (ms)</label>
          <input type="number" id="set-group-cooldown" min="0" max="60000" />
        </div>
        <div>
          <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Returning contact (days)</label>
          <input type="number" id="set-returning-days" min="1" max="365" />
        </div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px;">
      <button class="btn primary" onclick="saveSettings()">Save All Settings</button>
    </div>
  </div>

  <div id="toast" class="toast"></div>
</div>

<script>
let state = {};
let token = sessionStorage.getItem("dash_token") || "";

function getHeaders() {
  return token ? {"Authorization": "Bearer " + token, "content-type": "application/json"} : {"content-type": "application/json"};
}

function login() {
  const user = document.getElementById("username-input").value;
  const pw = document.getElementById("password-input").value;
  if (!user || !pw) return toast("Enter username and password", true);
  document.getElementById("login-error").style.display = "none";
  token = user + ":" + pw;
  sessionStorage.setItem("dash_token", token);
  loginAttempt().catch(() => {
    document.getElementById("login-error").style.display = "block";
    sessionStorage.removeItem("dash_token");
    token = "";
  });
}

async function loginAttempt() {
  const res = await authFetch("/api/dashboard/data");
  if (res.ok) {
    fetchData();
    return;
  }
  if (res.status === 401) throw new Error("bad auth");
  const text = await res.text().catch(() => "unknown error");
  toast("Server error: " + text.slice(0, 200), true);
}

async function authFetch(url, opts = {}) {
  const headers = {"Authorization": "Bearer " + token, ...(opts.headers || {})};
  if (opts.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(url, {...opts, headers});
  if (res.status === 401) {
    sessionStorage.removeItem("dash_token");
    token = "";
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("dashboard").style.display = "none";
    document.getElementById("login-error").style.display = "block";
  }
  if (res.status === 500) {
    console.error("Server error on", url);
  }
  return res;
}

async function fetchData() {
  try {
    const [dataRes, settingsRes] = await Promise.all([
      authFetch("/api/dashboard/data"),
      authFetch("/api/dashboard/settings"),
    ]);
    if (!dataRes.ok) return false;
    state = await dataRes.json();
    if (settingsRes.ok) {
      state.settings = await settingsRes.json();
    }
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    document.getElementById("login-error").style.display = "none";
    render();
    return true;
  } catch {
    return false;
  }
}

// Auto-login if token exists
if (token) fetchData().then(ok => {
  if (!ok && document.getElementById("login-screen").style.display !== "flex") {
    toast("Failed to load dashboard. Check console.", true);
  }
});

function render() {
  renderWeeklyStats();
  renderMonthlyUsage();
  renderModelStatus();
  renderGeminiUsage();
  renderGroqUsage();
  renderGeminiModels();
  renderGroqModels();
  renderBotStatus();
  renderFlaggedContacts();
  renderRecentActivity();
  if (state.settings) renderSettings(state.settings);
  document.getElementById("month-display").textContent = "Month: " + (state.usage?.month || "—");
}

// ── Overview upgrades ──

function renderBotStatus() {
  const toggle = document.getElementById("bot-status-toggle");
  const label = document.getElementById("bot-status-label");
  const slider = document.getElementById("bot-status-slider");
  const ts = document.getElementById("bot-status-timestamp");
  if (!toggle) return;
  authFetch("/api/conversations/global/mute").then(r => r.json().then(data => {
    toggle.checked = !data.muted;
    label.textContent = data.muted ? "Paused" : "Active";
    label.style.color = data.muted ? "#f87171" : "#4ade80";
    if (slider) slider.style.background = data.muted ? "#475569" : "#3b82f6";
  })).catch(() => {});
}

async function toggleBotStatus() {
  const toggle = document.getElementById("bot-status-toggle");
  const muted = !toggle.checked;
  const res = await authFetch("/api/conversations/" + "global" + "/mute", {
    method: "POST",
    body: JSON.stringify({muted}),
  });
  if (!res.ok) { toast("Failed to toggle", true); return; }
  document.getElementById("bot-status-label").textContent = muted ? "Paused" : "Active";
  document.getElementById("bot-status-label").style.color = muted ? "#f87171" : "#4ade80";
  document.getElementById("bot-status-timestamp").textContent = muted ? "Paused just now" : "Activated just now";
  document.getElementById("bot-status-slider").style.background = muted ? "#475569" : "#3b82f6";
  toast("Bot " + (muted ? "paused" : "activated"));
}

async function loadConversations() {
  const res = await authFetch("/api/conversations");
  if (!res.ok) return;
  state.conversations = await res.json();
  renderConversations();
  renderFlaggedContacts();
}

function renderConversations() {
  const list = state.conversations || [];
  const search = (document.getElementById("conv-search").value || "").toLowerCase();
  const filter = document.getElementById("conv-filter").value;
  const filtered = list.filter(c => {
    if (search && !c.chatId.includes(search) && !(c.lastMessage || "").toLowerCase().includes(search)) return false;
    if (filter === "pending" && !c.pendingReply) return false;
    if (filter === "muted" && !c.muted) return false;
    if (filter === "flagged" && !c.flaggedForHandoff) return false;
    return true;
  });
  const el = document.getElementById("conv-list");
  if (filtered.length === 0) {
    el.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">No conversations found</p>';
    return;
  }
  el.innerHTML = filtered.map(c => {
    const stage = c.relationshipStage || "stranger";
    const stageColor = stage === "regular" ? "#4ade80" : stage === "warm_lead" ? "#facc15" : stage === "acquaintance" ? "#60a5fa" : "#64748b";
    return '<div class="conv-row" onclick="selectConversation(\'' + c.chatId + '\')" style="padding:10px;border-bottom:1px solid #1e293b;cursor:pointer;' + (c.muted ? 'opacity:0.5;' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<code style="color:#93c5fd;font-size:0.8rem;">#' + esc(c.chatId) + '</code>' +
        '<div style="display:flex;gap:4px;align-items:center;">' +
          (c.pendingReply ? '<span style="width:8px;height:8px;border-radius:50%;background:#facc15;display:inline-block;" title="Pending reply"></span>' : '') +
          '<span style="background:' + stageColor + ';color:#0f172a;padding:1px 6px;border-radius:4px;font-size:0.65rem;">' + esc(stage) + '</span>' +
          (c.detectedLanguage ? '<span style="background:#334155;color:#94a3b8;padding:1px 6px;border-radius:4px;font-size:0.65rem;">' + esc(c.detectedLanguage) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="font-size:0.8rem;color:#94a3b8;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;">' + esc((c.lastMessage || "").slice(0, 60)) + '</div>' +
      '<div style="font-size:0.7rem;color:#64748b;margin-top:2px;">' + relativeTime(c.lastMessageAt) + '</div>' +
    '</div>';
  }).join("");
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 2) return "yesterday";
  return days + "d ago";
}

let selectedChatId = null;

async function selectConversation(chatId) {
  selectedChatId = chatId;
  const res = await authFetch("/api/conversations/" + chatId);
  if (!res.ok) return;
  const data = await res.json();
  const el = document.getElementById("conv-detail");
  const brain = data.brainOutput || {};
  const meta = data.meta || {};
  const intentOptions = ["price_inquiry", "complaint", "greeting", "request", "follow_up", "other"];
  const sentimentOptions = ["positive", "neutral", "negative"];
  const urgencyOptions = ["low", "medium", "high"];
  const stageOptions = ["stranger", "acquaintance", "warm_lead", "regular"];
  const langOptions = ["", "uz", "ru", "en", "uz_ru_mix"];
  const entries = data.entries || [];
  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<code style="color:#93c5fd;font-size:1rem;">#' + esc(chatId) + '</code>' +
      '<button class="btn sm" onclick="toggleMute(\'' + chatId + '\')" id="mute-btn-' + chatId + '">' + (meta.muted ? 'Unmute' : 'Mute') + '</button>' +
      '<button class="btn sm primary" onclick="showInjectModal(\'' + chatId + '\')">Inject reply</button>' +
      '<button class="btn sm" onclick="cancelPending(\'' + chatId + '\')">Cancel pending</button>' +
      '<button class="btn sm" onclick="runBrainNow(\'' + chatId + '\')">Run brain</button>' +
      '<button class="btn sm danger" onclick="resetBrain(\'' + chatId + '\')">Reset brain</button>' +
    '</div>' +
    '<div class="card" style="padding:12px;margin-bottom:12px;">' +
      '<h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:8px;">Brain Analysis</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:0.8rem;">' +
        '<div><label style="color:#64748b;">Intent</label><select onchange="patchBrainMeta(\'' + chatId + '\',\'intent\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + intentOptions.map(o => '<option value="' + o + '"' + (brain.intent === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Sentiment</label><select onchange="patchBrainMeta(\'' + chatId + '\',\'sentiment\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + sentimentOptions.map(o => '<option value="' + o + '"' + (brain.sentiment === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Urgency</label><select onchange="patchBrainMeta(\'' + chatId + '\',\'urgency\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + urgencyOptions.map(o => '<option value="' + o + '"' + (brain.urgency === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Stage</label><select onchange="patchBrainMeta(\'' + chatId + '\',\'relationship_stage\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + stageOptions.map(o => '<option value="' + o + '"' + (brain.relationship_stage === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Language</label><select onchange="patchBrainMeta(\'' + chatId + '\',\'forcedLanguage\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + langOptions.map(o => '<option value="' + o + '"' + ((meta.forcedLanguage || "") === o ? ' selected' : '') + '>' + (o || "auto") + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Confidence</label><input type="number" value="' + (brain.lastConfidence ?? 1) + '" min="0" max="1" step="0.01" onchange="patchBrainField(\'' + chatId + '\',\'lastConfidence\',parseFloat(this.value))" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;" /></div>' +
      '</div>' +
      (brain.persona_notes ? '<div style="margin-top:8px;"><label style="color:#64748b;font-size:0.8rem;">Persona notes</label><textarea rows="2" onchange="patchBrainField(\'' + chatId + '\',\'persona_notes\',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;font-family:monospace;">' + esc(brain.persona_notes) + '</textarea></div>' : '') +
    '</div>' +
    '<div class="card" style="padding:12px;">' +
      '<h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:8px;">Conversation History (' + entries.length + ' messages)</h3>' +
      '<div style="max-height:300px;overflow-y:auto;">' +
      entries.slice().reverse().map(e =>
        '<div style="padding:6px 0;border-bottom:1px solid #1e293b;' + (e.role === 'user' ? '' : 'background:rgba(59,130,246,0.05);') + '">' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<span style="background:' + (e.role === 'user' ? '#334155' : '#3b82f6') + ';color:#fff;padding:1px 8px;border-radius:4px;font-size:0.65rem;">' + e.role + '</span>' +
            '<span style="color:#64748b;font-size:0.65rem;">' + (e.timestamp ? new Date(e.timestamp).toLocaleString() : '') + '</span>' +
          '</div>' +
          '<div style="font-size:0.85rem;margin-top:2px;color:#e2e8f0;">' + esc(e.text) + '</div>' +
        '</div>'
      ).join("") +
      '</div>' +
    '</div>';
}

async function toggleMute(chatId) {
  const current = state.conversations.find(c => c.chatId === chatId);
  const muted = !(current && current.muted);
  const res = await authFetch("/api/conversations/" + chatId + "/mute", {
    method: "POST",
    body: JSON.stringify({muted}),
  });
  if (res.ok) {
    toast(muted ? "Muted" : "Unmuted");
    loadConversations();
  }
}

function showInjectModal(chatId) {
  const el = document.getElementById("conv-detail");
  const modal = document.createElement("div");
  modal.id = "inject-modal";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;";
  modal.innerHTML =
    '<div style="background:#1e293b;border-radius:12px;padding:24px;width:90%;max-width:500px;">' +
      '<h3 style="margin-bottom:12px;">Inject Reply to #' + esc(chatId) + '</h3>' +
      '<textarea id="inject-text" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;" placeholder="Type reply..."></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="btn primary" onclick="doInject(\'' + chatId + '\')">Send</button>' +
        '<button class="btn" onclick="document.getElementById(\'inject-modal\').remove()">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function doInject(chatId) {
  const text = document.getElementById("inject-text").value.trim();
  if (!text) return toast("Text required", true);
  const res = await authFetch("/api/conversations/" + chatId + "/inject", {
    method: "POST",
    body: JSON.stringify({text}),
  });
  if (res.ok) {
    toast("Message sent");
    document.getElementById("inject-modal").remove();
    selectConversation(chatId);
    loadConversations();
  } else toast("Failed to send", true);
}

async function cancelPending(chatId) {
  const res = await authFetch("/api/conversations/" + chatId + "/cancel-pending", {method: "POST"});
  if (res.ok) {
    toast("Pending replies cancelled");
    loadConversations();
  }
}

async function runBrainNow(chatId) {
  toast("Running brain analysis...");
  const res = await authFetch("/api/conversations/" + chatId + "/brain-run", {method: "POST"});
  if (res.ok) {
    toast("Brain analysis complete");
    selectConversation(chatId);
  } else toast("Brain run failed", true);
}

async function resetBrain(chatId) {
  if (!confirm("Reset brain data for this contact?")) return;
  const res = await authFetch("/api/conversations/" + chatId + "/brain-reset", {method: "POST"});
  if (res.ok) {
    toast("Brain reset");
    selectConversation(chatId);
  }
}

async function patchBrainMeta(chatId, field, value) {
  const res = await authFetch("/api/conversations/" + chatId + "/meta", {
    method: "PATCH",
    body: JSON.stringify({[field === "relationship_stage" ? field : field === "intent" ? "lastIntent" : field === "sentiment" ? "lastSentiment" : field === "urgency" ? "lastUrgency" : field]: value}),
  });
  if (!res.ok) toast("Failed to update", true);
}

async function patchBrainField(chatId, field, value) {
  const res = await authFetch("/api/brain/" + chatId, {
    method: "PATCH",
    body: JSON.stringify({[field]: value}),
  });
  if (!res.ok) toast("Failed to update", true);
}

function renderFlaggedContacts() {
  const list = (state.conversations || []).filter(c => c.flaggedForHandoff);
  const card = document.getElementById("flagged-contacts-card");
  const el = document.getElementById("flagged-contacts-list");
  if (list.length === 0) { card.style.display = "none"; return; }
  card.style.display = "block";
  el.innerHTML = list.map(c =>
    '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b;">' +
      '<code style="color:#93c5fd;">#' + esc(c.chatId) + '</code>' +
      '<span style="flex:1;color:#94a3b8;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc((c.lastMessage || "").slice(0, 40)) + '</span>' +
      '<span style="background:#f87171;color:#fff;padding:1px 6px;border-radius:4px;font-size:0.65rem;">' + esc(c.urgency) + '</span>' +
      '<button class="btn sm" onclick="selectConversation(\'' + c.chatId + '\');switchTab(\'conversations\')">View</button>' +
    '</div>'
  ).join("");
}

function renderRecentActivity() {
  const list = (state.conversations || []).slice(0, 10);
  const el = document.getElementById("recent-activity");
  if (list.length === 0) { el.innerHTML = '<p style="color:#64748b;">No recent activity</p>'; return; }
  el.innerHTML = list.map(c =>
    '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #1e293b;font-size:0.85rem;">' +
      '<code style="color:#93c5fd;font-size:0.75rem;">#' + esc(c.chatId) + '</code>' +
      '<span style="flex:1;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc((c.lastMessage || "").slice(0, 50)) + '</span>' +
      (c.intent ? '<span style="background:#334155;color:#94a3b8;padding:1px 6px;border-radius:4px;font-size:0.65rem;">' + esc(c.intent) + '</span>' : '') +
      '<span style="color:#64748b;font-size:0.7rem;">' + relativeTime(c.lastMessageAt) + '</span>' +
    '</div>'
  ).join("");
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.querySelector('[data-tab="' + name + '"]').classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

// ── Brain tab ──

async function loadBrainTab() {
  const res = await authFetch("/api/brain/overview");
  if (!res.ok) return;
  const data = await res.json();
  renderBrainStats(data);
  renderBrainBreakdown(data.intentBreakdown || {}, "brain-intent-breakdown", ["#60a5fa","#facc15","#f87171","#4ade80","#a78bfa","#64748b"]);
  renderBrainBreakdown(data.sentimentBreakdown || {}, "brain-sentiment-breakdown", ["#4ade80","#94a3b8","#f87171"]);
  // low confidence
  const lcRes = await authFetch("/api/brain/low-confidence");
  if (lcRes.ok) {
    const lc = await lcRes.json();
    const tbody = document.getElementById("brain-lowconf-table");
    if (lc.length === 0) { tbody.innerHTML = '<tr><td colspan="4" style="color:#64748b;text-align:center;">No low-confidence contacts</td></tr>'; return; }
    tbody.innerHTML = lc.map(c =>
      '<tr><td><code style="color:#93c5fd;">#' + esc(c.chatId) + '</code></td><td style="color:#f87171;">' + (c.lastConfidence || 0).toFixed(2) + '</td><td style="color:#94a3b8;font-size:0.8rem;">' + esc((c.personaNotes || "").slice(0, 40)) + '</td><td><button class="btn sm" onclick="runBrainNow(\'' + c.chatId + '\')">Run brain</button></td></tr>'
    ).join("");
  }
}

function renderBrainStats(data) {
  const el = document.getElementById("brain-stats");
  el.innerHTML =
    statCard("Analyzed", data.totalAnalyzed || 0, "blue") +
    statCard("Avg Confidence", (data.avgConfidence || 0).toFixed(2), data.avgConfidence > 0.65 ? "green" : "yellow") +
    statCard("Intents", Object.keys(data.intentBreakdown || {}).length, "blue") +
    statCard("Pending", 0, "yellow");
}

function renderBrainBreakdown(data, elementId, colors) {
  const el = document.getElementById(elementId);
  const entries = Object.entries(data);
  if (entries.length === 0) { el.innerHTML = '<p style="color:#64748b;">No data</p>'; return; }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  el.innerHTML = entries.map(([key, val], i) => {
    const pct = total > 0 ? (val / total * 100) : 0;
    return '<div style="margin-bottom:6px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:2px;">' +
        '<span>' + esc(key) + '</span><span>' + val + ' (' + pct.toFixed(0) + '%)</span>' +
      '</div>' +
      '<div style="background:#1e293b;border-radius:4px;height:16px;overflow:hidden;">' +
        '<div style="height:100%;width:' + pct + '%;background:' + (colors[i % colors.length]) + ';border-radius:4px;transition:width 0.3s;"></div>' +
      '</div>' +
    '</div>';
  }).join("");
}

async function loadBrainEditor() {
  const chatId = document.getElementById("brain-editor-chatid").value.trim();
  if (!chatId) return toast("Enter a chat ID", true);
  const res = await authFetch("/api/brain/" + chatId);
  if (!res.ok) return toast("Contact not found", true);
  const data = await res.json();
  const output = data.output || {};
  const el = document.getElementById("brain-editor-fields");
  const intentOptions = ["price_inquiry", "complaint", "greeting", "request", "follow_up", "other"];
  const sentimentOptions = ["positive", "neutral", "negative"];
  const urgencyOptions = ["low", "medium", "high"];
  const stageOptions = ["stranger", "acquaintance", "warm_lead", "regular"];
  const langOptions = ["", "uz", "ru", "en", "uz_ru_mix"];
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Intent</label><select id="be-intent" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;">' + intentOptions.map(o => '<option value="' + o + '"' + (output.intent === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Sentiment</label><select id="be-sentiment" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;">' + sentimentOptions.map(o => '<option value="' + o + '"' + (output.sentiment === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Urgency</label><select id="be-urgency" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;">' + urgencyOptions.map(o => '<option value="' + o + '"' + (output.urgency === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Stage</label><select id="be-stage" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;">' + stageOptions.map(o => '<option value="' + o + '"' + (output.relationship_stage === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Language</label><select id="be-lang" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;">' + langOptions.map(o => '<option value="' + o + '"' + ((output.detectedLanguage || "") === o ? ' selected' : '') + '>' + (o || "auto") + '</option>').join("") + '</select></div>' +
      '<div><label style="color:#64748b;font-size:0.8rem;">Confidence</label><input type="number" id="be-confidence" value="' + (output.lastConfidence ?? 1) + '" min="0" max="1" step="0.01" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;" /></div>' +
    '</div>' +
    '<div style="margin-top:8px;"><label style="color:#64748b;font-size:0.8rem;">Persona Notes</label><textarea id="be-notes" rows="2" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-family:monospace;">' + esc(output.persona_notes || "") + '</textarea></div>' +
    '<div style="margin-top:8px;"><label style="color:#64748b;font-size:0.8rem;">Summary</label><textarea id="be-summary" rows="3" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-family:monospace;">' + esc(data.summary || "") + '</textarea></div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn primary" onclick="saveBrainEditor(\'' + chatId + '\')">Save Changes</button>' +
      '<button class="btn" onclick="runBrainNow(\'' + chatId + '\')">Run Brain Now</button>' +
      '<button class="btn danger" onclick="resetBrain(\'' + chatId + '\')">Reset Brain</button>' +
    '</div>';
}

async function saveBrainEditor(chatId) {
  const body = {
    intent: document.getElementById("be-intent").value,
    sentiment: document.getElementById("be-sentiment").value,
    urgency: document.getElementById("be-urgency").value,
    relationship_stage: document.getElementById("be-stage").value,
    detectedLanguage: document.getElementById("be-lang").value,
    lastConfidence: parseFloat(document.getElementById("be-confidence").value) || 1,
    persona_notes: document.getElementById("be-notes").value,
    lastUpdated: Date.now(),
  };
  const promises = [
    authFetch("/api/brain/" + chatId, {method: "PATCH", body: JSON.stringify(body)}),
    authFetch("/api/conversations/" + chatId + "/meta", {method: "PATCH", body: JSON.stringify({
      lastIntent: body.intent,
      lastSentiment: body.sentiment,
      relationshipStage: body.relationship_stage,
    })}),
  ];
  const summary = document.getElementById("be-summary").value.trim();
  if (summary) {
    const kvP = authFetch("/api/brain/" + chatId, {method: "PATCH", body: JSON.stringify({summary})});
    promises.push(kvP);
  }
  const results = await Promise.all(promises);
  if (results.every(r => r.ok)) toast("Brain data saved");
  else toast("Some fields failed to save", true);
}

// ── Commands tab ──

let commandList = [];
let editingCommandId = null;

async function loadCommands() {
  const res = await authFetch("/api/commands");
  if (!res.ok) return;
  commandList = await res.json();
  renderCommandList();
}

function renderCommandList() {
  const el = document.getElementById("command-list");
  if (commandList.length === 0) {
    el.innerHTML = '<p style="color:#64748b;margin-top:12px;">No commands yet</p>';
    return;
  }
  el.innerHTML = commandList.map(c =>
    '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1e293b;">' +
      '<code style="background:#0f172a;padding:2px 8px;border-radius:4px;color:#93c5fd;">/' + esc(c.name) + '</code>' +
      '<span style="flex:1;color:#94a3b8;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(c.description) + '</span>' +
      '<label style="position:relative;display:inline-block;width:36px;height:20px;"><input type="checkbox" ' + (c.enabled ? 'checked' : '') + ' onchange="toggleCommand(\'' + c.id + '\',this.checked)" style="opacity:0;width:0;height:0;"><span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:' + (c.enabled ? '#3b82f6' : '#475569') + ';border-radius:20px;transition:0.3s;"></span></label>' +
      '<button class="btn sm" onclick="editCommand(\'' + c.id + '\')">Edit</button>' +
      '<span style="cursor:pointer;color:#ef4444;font-size:0.8rem;" onclick="deleteCommand(\'' + c.id + '\')">✕</span>' +
    '</div>'
  ).join("");
}

async function toggleCommand(id, enabled) {
  await authFetch("/api/commands/" + id, {method: "PATCH", body: JSON.stringify({enabled})});
  loadCommands();
}

function startNewCommand() {
  editingCommandId = null;
  renderCommandEditor({name: "", description: "", instruction: "", generatedPrompt: "", enabled: true});
}

function editCommand(id) {
  editingCommandId = id;
  const cmd = commandList.find(c => c.id === id);
  if (cmd) renderCommandEditor(cmd);
}

function renderCommandEditor(cmd) {
  const el = document.getElementById("command-editor");
  el.innerHTML =
    '<h3 style="margin-bottom:12px;">' + (editingCommandId ? 'Edit Command' : 'New Command') + '</h3>' +
    '<div style="margin-bottom:8px;"><label style="color:#64748b;font-size:0.8rem;">Command Name (no slash)</label><input type="text" id="ce-name" value="' + esc(cmd.name || "") + '" placeholder="report" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-family:monospace;" /></div>' +
    '<div style="margin-bottom:8px;"><label style="color:#64748b;font-size:0.8rem;">Description</label><input type="text" id="ce-desc" value="' + esc(cmd.description || "") + '" placeholder="Shown in Telegram command list" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;" /></div>' +
    '<div style="margin-bottom:8px;"><label style="color:#64748b;font-size:0.8rem;">Instruction (what should this command do?)</label><textarea id="ce-instr" rows="3" placeholder="In plain language..." style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-family:monospace;resize:vertical;">' + esc(cmd.instruction || "") + '</textarea></div>' +
    '<button class="btn primary sm" onclick="generateCommandPrompt()" style="margin-bottom:12px;">Generate Prompt</button>' +
    '<div style="margin-bottom:8px;"><label style="color:#64748b;font-size:0.8rem;">Generated Prompt (editable)</label><textarea id="ce-prompt" rows="6" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-family:monospace;resize:vertical;">' + esc(cmd.generatedPrompt || "") + '</textarea></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
      '<button class="btn" onclick="testCommandPrompt()">Test This Command</button>' +
    '</div>' +
    '<div id="ce-test-result" style="margin-bottom:12px;"></div>' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">' +
      '<label style="color:#64748b;font-size:0.8rem;">Enabled</label>' +
      '<input type="checkbox" id="ce-enabled" ' + (cmd.enabled !== false ? 'checked' : '') + ' />' +
    '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="btn primary" onclick="saveCommand()">Save Command</button>' +
      (editingCommandId ? '<button class="btn" onclick="registerCommand()">Register with Telegram</button>' : '') +
    '</div>';
}

async function generateCommandPrompt() {
  const name = document.getElementById("ce-name").value.trim();
  const desc = document.getElementById("ce-desc").value.trim();
  const instr = document.getElementById("ce-instr").value.trim();
  if (!name || !desc || !instr) return toast("Fill name, description, and instruction first", true);
  document.querySelector("#command-editor .btn.primary").textContent = "Generating...";
  const res = await authFetch("/api/commands/generate", {
    method: "POST",
    body: JSON.stringify({name, description: desc, instruction: instr}),
  });
  document.querySelector("#command-editor .btn.primary").textContent = "Generate Prompt";
  if (!res.ok) return toast("Generation failed", true);
  const data = await res.json();
  document.getElementById("ce-prompt").value = data.generatedPrompt;
  toast("Prompt generated");
}

async function testCommandPrompt() {
  const prompt = document.getElementById("ce-prompt").value.trim();
  const name = document.getElementById("ce-name").value.trim();
  if (!prompt) return toast("Generate or enter a prompt first", true);
  document.getElementById("ce-test-result").innerHTML = '<p style="color:#64748b;">Running test...</p>';
  const res = await authFetch("/api/commands/test", {
    method: "POST",
    body: JSON.stringify({generatedPrompt: prompt, name}),
  });
  if (!res.ok) { document.getElementById("ce-test-result").innerHTML = '<p style="color:#f87171;">Test failed</p>'; return; }
  const data = await res.json();
  document.getElementById("ce-test-result").innerHTML =
    '<div style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:12px;">' +
      '<div style="font-size:0.85rem;color:#e2e8f0;white-space:pre-wrap;">' + esc(data.output) + '</div>' +
      '<div style="margin-top:8px;"><button class="btn sm" onclick="testCommandPrompt()">Re-test</button></div>' +
    '</div>';
}

async function saveCommand() {
  const data = {
    name: document.getElementById("ce-name").value.trim(),
    description: document.getElementById("ce-desc").value.trim(),
    instruction: document.getElementById("ce-instr").value.trim(),
    generatedPrompt: document.getElementById("ce-prompt").value.trim(),
    enabled: document.getElementById("ce-enabled").checked,
  };
  if (!data.name || !data.description) return toast("Name and description required", true);
  if (editingCommandId) {
    const res = await authFetch("/api/commands/" + editingCommandId, {method: "PATCH", body: JSON.stringify(data)});
    if (!res.ok) return toast("Failed to update", true);
    toast("Command updated");
  } else {
    const res = await authFetch("/api/commands", {method: "POST", body: JSON.stringify(data)});
    if (!res.ok) return toast("Failed to create", true);
    toast("Command created");
  }
  loadCommands();
}

async function deleteCommand(id) {
  if (!confirm("Delete this command?")) return;
  const res = await authFetch("/api/commands/" + id, {method: "DELETE"});
  if (res.ok) { toast("Command deleted"); loadCommands(); }
}

async function registerCommand() {
  const res = await authFetch("/api/commands/" + editingCommandId + "/register", {method: "POST"});
  if (res.ok) toast("Commands registered with Telegram");
  else toast("Registration failed", true);
}

// ── Persona tab ──

async function loadPersonaTab() {
  const settings = state.settings;
  if (!settings) return;
  renderTimePersonality(settings);
  renderRelationshipStages(settings);
}

function renderTimePersonality(s) {
  const slots = ["morning", "midday", "afternoon", "evening", "night"];
  const hours = {morning: "06-10", midday: "10-14", afternoon: "14-18", evening: "18-22", night: "22-06"};
  const tp = s.timePersonality || {};
  const el = document.getElementById("time-personality-editor");
  el.innerHTML = slots.map(slot =>
    '<div style="margin-bottom:8px;padding:8px;background:#0f172a;border-radius:6px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">' +
        '<span style="color:#94a3b8;font-size:0.85rem;text-transform:capitalize;">' + slot + '</span>' +
        '<span style="color:#64748b;font-size:0.75rem;">' + hours[slot] + '</span>' +
      '</div>' +
      '<textarea data-tp-slot="' + slot + '" rows="2" placeholder="Tone description for ' + slot + '..." style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:6px 8px;color:#e2e8f0;font-size:0.8rem;font-family:monospace;resize:vertical;">' + esc(tp[slot] || "") + '</textarea>' +
    '</div>'
  ).join("");
  el.innerHTML += '<button class="btn primary sm" onclick="saveTimePersonality()">Save Time Personality</button>';
}

async function saveTimePersonality() {
  const textareas = document.querySelectorAll("#time-personality-editor textarea[data-tp-slot]");
  const timePersonality = {};
  textareas.forEach(ta => { if (ta.value.trim()) timePersonality[ta.dataset.tpSlot] = ta.value.trim(); });
  const settings = state.settings || {};
  settings.timePersonality = timePersonality;
  const res = await authFetch("/api/dashboard/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  if (res.ok) toast("Time personality saved");
  else toast("Failed to save", true);
}

function renderRelationshipStages(s) {
  const stages = ["stranger", "acquaintance", "warm_lead", "regular"];
  const labels = {stranger: "Stranger", acquaintance: "Acquaintance", warm_lead: "Warm Lead", regular: "Regular"};
  const bt = s.businessMode || {};
  const el = document.getElementById("relationship-stage-editor");
  el.innerHTML = stages.map(stage =>
    '<div style="margin-bottom:8px;padding:8px;background:#0f172a;border-radius:6px;">' +
      '<div style="color:#94a3b8;font-size:0.85rem;margin-bottom:4px;">' + (labels[stage] || stage) + '</div>' +
      '<input type="text" data-rs-stage="' + stage + '" placeholder="Tone for ' + stage + '..." value="' + esc(s.speechPatterns?.[stage + "_tone"] || "") + '" style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:6px 8px;color:#e2e8f0;font-size:0.8rem;margin-bottom:4px;" />' +
      '<input type="text" data-rs-style="' + stage + '" placeholder="Reply style..." value="' + esc(s.speechPatterns?.[stage + "_style"] || "") + '" style="width:100%;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:6px 8px;color:#e2e8f0;font-size:0.8rem;" />' +
    '</div>'
  ).join("");
  el.innerHTML += '<button class="btn primary sm" onclick="saveRelationshipStages()">Save Stages</button>';
}

async function saveRelationshipStages() {
  const toneInputs = document.querySelectorAll("#relationship-stage-editor input[data-rs-stage]");
  const styleInputs = document.querySelectorAll("#relationship-stage-editor input[data-rs-style]");
  const speechPatterns = {...(state.settings?.speechPatterns || {})};
  toneInputs.forEach(inp => { speechPatterns[inp.dataset.rsStage + "_tone"] = inp.value.trim(); });
  styleInputs.forEach(inp => { speechPatterns[inp.dataset.rsStyle + "_style"] = inp.value.trim(); });
  const settings = state.settings || {};
  settings.speechPatterns = speechPatterns;
  const res = await authFetch("/api/dashboard/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  if (res.ok) toast("Relationship stages saved");
  else toast("Failed to save", true);
}

async function testPersona() {
  const message = document.getElementById("persona-test-message").value.trim();
  const language = document.getElementById("persona-test-lang").value;
  if (!message) return toast("Enter a test message", true);
  document.getElementById("persona-test-result").style.display = "block";
  document.getElementById("persona-test-reply").innerHTML = '<p style="color:#64748b;">Testing...</p>';
  document.getElementById("persona-test-confidence").innerHTML = "";
  document.getElementById("persona-test-antipatterns").innerHTML = "";
  const res = await authFetch("/api/persona/test", {
    method: "POST",
    body: JSON.stringify({message, language}),
  });
  if (!res.ok) { document.getElementById("persona-test-reply").innerHTML = '<p style="color:#f87171;">Test failed</p>'; return; }
  const data = await res.json();
  document.getElementById("persona-test-reply").innerHTML = '<p style="color:#e2e8f0;white-space:pre-wrap;">' + esc(data.reply) + '</p>';
  const confColor = data.confidence >= 0.8 ? "#4ade80" : data.confidence >= 0.5 ? "#facc15" : "#f87171";
  document.getElementById("persona-test-confidence").innerHTML = '<span style="color:' + confColor + ';font-size:0.85rem;">Confidence: ' + (data.confidence || 0).toFixed(2) + '</span>';
  if (data.detectedAntiPatterns && data.detectedAntiPatterns.length > 0) {
    document.getElementById("persona-test-antipatterns").innerHTML = '<p style="color:#f87171;font-size:0.8rem;">Anti-patterns detected:</p><ul>' + data.detectedAntiPatterns.map(p => '<li style="color:#fca5a5;font-size:0.8rem;">' + esc(p) + '</li>').join("") + '</ul>';
  }
}

async function loadPersonaHistory() {
  const res = await authFetch("/api/persona/history");
  if (!res.ok) return;
  const history = await res.json();
  const el = document.getElementById("persona-history-list");
  if (history.length === 0) { el.innerHTML = '<p style="color:#64748b;">No history yet</p>'; return; }
  el.innerHTML = history.map((h, i) =>
    '<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #1e293b;">' +
      '<span style="color:#94a3b8;font-size:0.8rem;">' + new Date(h.savedAt).toLocaleString() + '</span>' +
      '<button class="btn sm" onclick="revertPersona(' + h.savedAt + ')">Revert</button>' +
    '</div>'
  ).join("");
}

async function revertPersona(savedAt) {
  if (!confirm("Revert to this saved version?")) return;
  const res = await authFetch("/api/persona/revert/" + savedAt, {method: "POST"});
  if (res.ok) { toast("Reverted"); fetchData(); }
  else toast("Revert failed", true);
}

// ── Model cooldowns ──

async function loadModelCooldowns() {
  const res = await authFetch("/api/dashboard/models/cooldowns");
  if (!res.ok) return;
  const cooldowns = await res.json();
  const el = document.getElementById("model-cooldowns") || document.createElement("div");
  el.id = "model-cooldowns";
  if (!document.getElementById("model-cooldowns")) {
    const modelStatus = document.getElementById("model-status");
    modelStatus.parentNode.insertBefore(el, modelStatus.nextSibling);
  }
  const active = cooldowns.filter(c => c.coolingDown);
  if (active.length === 0) { el.innerHTML = '<p style="color:#94a3b8;font-size:0.8rem;margin-top:8px;">No models in cooldown</p>'; return; }
  el.innerHTML = '<h3 style="font-size:0.85rem;color:#f87171;margin-top:12px;margin-bottom:8px;">Models in Cooldown</h3>' +
    active.map(c => {
      const remaining = Math.max(0, c.expiresAt - Date.now());
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:0.8rem;">' +
        '<span style="color:#f87171;">' + esc(c.model) + '</span>' +
        '<span style="color:#94a3b8;">Cooldown expires in ' + hours + 'h ' + mins + 'm</span>' +
        '<button class="btn sm" onclick="clearCooldown(\'' + esc(c.model) + '\')">Clear</button>' +
      '</div>';
    }).join("");
}

async function clearCooldown(model) {
  const res = await authFetch("/api/dashboard/models/cooldown/" + encodeURIComponent(model), {method: "POST"});
  if (res.ok) { toast("Cooldown cleared"); loadModelCooldowns(); }
}

function renderWeeklyStats() {
  const w = state.weekly || {};
  document.getElementById("weekly-stats").innerHTML =
    statCard("Messages", w.totalMessages || 0, "green") +
    statCard("Chats Seen", w.conversationsSeen || 0, "blue") +
    statCard("Brain Runs", w.brainRunCount || 0, "yellow") +
    statCard("Low Confidence", w.lowConfTotal || 0, w.lowConfTotal > 5 ? "red" : "yellow") +
    statCard("Unresolved", w.unresolvedCount || 0, "red");
}

function renderMonthlyUsage() {
  const u = state.usage || {};
  const g = u.gemini?.total || {};
  const r = u.groq?.total || {};
  document.getElementById("monthly-usage").innerHTML =
    statCard("Gemini Calls", g.calls || 0, "blue") +
    statCard("Gemini Tokens", (g.inputTokens + g.outputTokens || 0).toLocaleString(), "blue") +
    statCard("Groq Calls", r.calls || 0, "yellow") +
    statCard("Groq Tokens", (r.inputTokens + r.outputTokens || 0).toLocaleString(), "yellow");
}

function renderModelStatus() {
  const m = state.models || {};
  const geminiModels = m.gemini || [];
  const groq = m.groq || {};
  const groqChat = groq.chatModels || [];
  const groqJson = groq.jsonModels || [];
  document.getElementById("model-status").innerHTML =
    '<div style="margin-bottom:8px;"><span style="color:#64748b;font-size:0.8rem;">Gemini:</span> ' +
    geminiModels.map((m, i) => '<span class="model-tag' + (i===0?' primary':'') + '">' + esc(m) + '</span>').join("") +
    '</div><div><span style="color:#64748b;font-size:0.8rem;">Groq Chat:</span> ' +
    groqChat.map((m) => '<span class="model-tag">' + esc(m) + '</span>').join("") +
    '</div><div><span style="color:#64748b;font-size:0.8rem;">Groq JSON:</span> ' +
    groqJson.map((m) => '<span class="model-tag">' + esc(m) + '</span>').join("") + '</div>' +
    '<div id="model-cooldowns"></div>';
  loadModelCooldowns();
}

function renderGeminiUsage() {
  const models = state.usage?.gemini?.models || {};
  const tbody = document.querySelector("#gemini-usage-table tbody");
  const entries = Object.entries(models);
  if (entries.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="color:#64748b;text-align:center;">No usage yet</td></tr>'; return; }
  tbody.innerHTML = entries.map(([model, data]) =>
    '<tr><td>' + esc(model) + '</td><td>' + data.calls + '</td><td>' + data.inputTokens.toLocaleString() + '</td><td>' + data.outputTokens.toLocaleString() + '</td><td>' + (data.inputTokens + data.outputTokens).toLocaleString() + '</td></tr>'
  ).join("");
}

function renderGroqUsage() {
  const models = state.usage?.groq?.models || {};
  const tbody = document.querySelector("#groq-usage-table tbody");
  const entries = Object.entries(models);
  if (entries.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="color:#64748b;text-align:center;">No usage yet</td></tr>'; return; }
  tbody.innerHTML = entries.map(([model, data]) =>
    '<tr><td>' + esc(model) + '</td><td>' + data.calls + '</td><td>' + data.inputTokens.toLocaleString() + '</td><td>' + data.outputTokens.toLocaleString() + '</td><td>' + (data.inputTokens + data.outputTokens).toLocaleString() + '</td></tr>'
  ).join("");
}

let geminiModels = [];

function renderGeminiModels() {
  geminiModels = (state.models?.gemini || []).slice();
  updateGeminiUI();
}

function updateGeminiUI() {
  const el = document.getElementById("gemini-model-list");
  if (geminiModels.length === 0) { el.innerHTML = '<span style="color:#64748b;">No models configured</span>'; return; }
  el.innerHTML = geminiModels.map((m, i) =>
    '<span class="model-tag' + (i===0?' primary':'') + '">' + esc(m) +
    ' <span style="cursor:pointer;color:#ef4444;margin-left:4px;" onclick="removeGeminiModel(' + i + ')">✕</span></span>'
  ).join("");
}

function addGeminiModel() {
  const input = document.getElementById("gemini-model-input");
  const val = input.value.trim();
  if (val && !geminiModels.includes(val)) { geminiModels.push(val); input.value = ""; updateGeminiUI(); }
}

function removeGeminiModel(i) { geminiModels.splice(i, 1); updateGeminiUI(); }

async function saveGeminiModels() {
  if (geminiModels.length === 0) return toast("Need at least one model", true);
  const res = await authFetch("/api/dashboard/models/gemini", {
    method: "PUT", headers: {"content-type": "application/json"},
    body: JSON.stringify({models: geminiModels}),
  });
  if (res.ok) { toast("Gemini models saved"); fetchData(); }
  else toast("Failed to save", true);
}

async function resetGeminiModels() {
  const res = await authFetch("/api/dashboard/models/gemini/reset", {method: "POST"});
  if (res.ok) { toast("Gemini models reset to defaults"); fetchData(); }
}

let groqChatModels = [];
let groqJsonModels = [];

function renderGroqModels() {
  groqChatModels = (state.models?.groq?.chatModels || []).slice();
  groqJsonModels = (state.models?.groq?.jsonModels || []).slice();
  updateGroqUI();
}

function updateGroqUI() {
  const chatEl = document.getElementById("groq-chat-model-list");
  chatEl.innerHTML = groqChatModels.map((m, i) =>
    '<span class="model-tag">' + esc(m) +
    ' <span style="cursor:pointer;color:#ef4444;margin-left:4px;" onclick="removeGroqChatModel(' + i + ')">✕</span></span>'
  ).join("") || '<span style="color:#64748b;">No models</span>';

  const jsonEl = document.getElementById("groq-json-model-list");
  jsonEl.innerHTML = groqJsonModels.map((m, i) =>
    '<span class="model-tag">' + esc(m) +
    ' <span style="cursor:pointer;color:#ef4444;margin-left:4px;" onclick="removeGroqJsonModel(' + i + ')">✕</span></span>'
  ).join("") || '<span style="color:#64748b;">No models</span>';
}

function addGroqChatModel() {
  const input = document.getElementById("groq-chat-input");
  const val = input.value.trim();
  if (val && !groqChatModels.includes(val)) { groqChatModels.push(val); input.value = ""; updateGroqUI(); }
}
function removeGroqChatModel(i) { groqChatModels.splice(i, 1); updateGroqUI(); }
function addGroqJsonModel() {
  const input = document.getElementById("groq-json-input");
  const val = input.value.trim();
  if (val && !groqJsonModels.includes(val)) { groqJsonModels.push(val); input.value = ""; updateGroqUI(); }
}
function removeGroqJsonModel(i) { groqJsonModels.splice(i, 1); updateGroqUI(); }

async function saveGroqModels() {
  if (groqChatModels.length === 0 || groqJsonModels.length === 0) return toast("Need at least one model per type", true);
  const res = await authFetch("/api/dashboard/models/groq", {
    method: "PUT", headers: {"content-type": "application/json"},
    body: JSON.stringify({chatModels: groqChatModels, jsonModels: groqJsonModels}),
  });
  if (res.ok) { toast("Groq models saved"); fetchData(); }
  else toast("Failed to save", true);
}

async function resetGroqModels() {
  const res = await authFetch("/api/dashboard/models/groq/reset", {method: "POST"});
  if (res.ok) { toast("Groq models reset to defaults"); fetchData(); }
}

async function resetUsage() {
  if (!confirm("Reset monthly usage stats?")) return;
  const res = await authFetch("/api/dashboard/usage/reset", {method: "POST"});
  if (res.ok) { toast("Usage reset"); fetchData(); }
}

// ── Settings tab ──
async function loadSettings() {
  const res = await authFetch("/api/dashboard/settings");
  if (!res.ok) return;
  const s = await res.json();
  state.settings = s;
  renderSettings(s);
}

function renderSettings(s) {
  document.getElementById("set-name").value = s.name || "";
  document.getElementById("set-owner").value = s.ownerName || "";
  document.getElementById("set-from").value = s.background?.from || "";
  document.getElementById("set-work").value = s.background?.work || "";
  document.getElementById("set-style").value = s.background?.style || "";
  document.getElementById("set-languages").value = (s.background?.languages || []).join(", ");

  document.getElementById("set-absolute-rules").value = (s.absoluteRules || []).join("\\n");
  document.getElementById("set-never-say").value = (s.neverSay || []).join("\\n");
  document.getElementById("set-behavior-rules").value = (s.behaviorRules || []).join("\\n");
  document.getElementById("set-fallback-rules").value = (s.fallbackRules || []).join("\\n");

  document.getElementById("set-contact").value = (s.businessMode?.contact || []).join("\\n");
  document.getElementById("set-business-tone").value = s.businessMode?.tone || "";

  // Reply Timing
  const rt = s.replyTiming || {};
  document.getElementById("set-rt-conversation-gap").value = rt.conversationGapMinutes ?? 30;
  document.getElementById("set-rt-first-delay").value = rt.firstReplyDelaySeconds ?? 240;
  document.getElementById("set-rt-slow-delay").value = rt.slowReplyDelaySeconds ?? 240;
  document.getElementById("set-rt-normal-delay").value = rt.normalReplyDelaySeconds ?? 90;
  document.getElementById("set-rt-slow-threshold").value = rt.slowThresholdSeconds ?? 180;
  document.getElementById("set-rt-random-extra").value = rt.randomExtraMaxSeconds ?? 120;

  // Confidence
  const conf = s.confidence || {};
  document.getElementById("set-conf-enabled").value = conf.enabled !== false ? "true" : "false";
  document.getElementById("set-conf-threshold").value = conf.fallbackThreshold ?? 0.65;
  document.getElementById("set-conf-phrases").value = (conf.fallbackPhrases || []).join("\\n");

  // Low conf alert
  document.getElementById("set-lowconf-threshold").value = s.lowConfAlertThreshold ?? 3;

  // Typing
  document.getElementById("set-typing-mschar").value = s.typingMsPerChar ?? 45;
  document.getElementById("set-typing-maxms").value = s.typingMaxMs ?? 4000;

  // AI response limits
  document.getElementById("set-max-chars").value = s.maxResponseChars ?? 500;
  document.getElementById("set-max-sentences").value = s.maxResponseSentences ?? 3;

  // Brain
  document.getElementById("set-brain-enabled").value = s.brainAnalysisEnabled !== false ? "true" : "false";
  document.getElementById("set-brain-interval").value = s.brainAnalysisInterval ?? 4;

  // AI fallbacks
  document.getElementById("set-ai-fallbacks").value = (s.aiFallbackPhrases || []).join("\\n");

  // Other
  document.getElementById("set-group-cooldown").value = s.groupReplyCooldownMs ?? 12000;
  document.getElementById("set-returning-days").value = s.returningContactDays ?? 7;

}

function collectSettings() {
  return {
    name: document.getElementById("set-name").value.trim(),
    ownerName: document.getElementById("set-owner").value.trim(),
    background: {
      from: document.getElementById("set-from").value.trim(),
      timezone: "Asia/Tashkent (UTC+5)",
      work: document.getElementById("set-work").value.trim(),
      style: document.getElementById("set-style").value.trim(),
      languages: document.getElementById("set-languages").value.split(",").map((s) => s.trim()).filter(Boolean),
    },
    absoluteRules: document.getElementById("set-absolute-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    neverSay: document.getElementById("set-never-say").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    behaviorRules: document.getElementById("set-behavior-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    fallbackRules: document.getElementById("set-fallback-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    businessMode: {
      contact: document.getElementById("set-contact").value.split("\\n").map((s) => s.trim()).filter(Boolean),
      tone: document.getElementById("set-business-tone").value.trim(),
    },
    replyTiming: {
      conversationGapMinutes: parseInt(document.getElementById("set-rt-conversation-gap").value) || 30,
      firstReplyDelaySeconds: parseInt(document.getElementById("set-rt-first-delay").value) || 240,
      slowReplyDelaySeconds: parseInt(document.getElementById("set-rt-slow-delay").value) || 240,
      normalReplyDelaySeconds: parseInt(document.getElementById("set-rt-normal-delay").value) || 90,
      slowThresholdSeconds: parseInt(document.getElementById("set-rt-slow-threshold").value) || 180,
      randomExtraMaxSeconds: parseInt(document.getElementById("set-rt-random-extra").value) || 120,
    },
    confidence: {
      enabled: document.getElementById("set-conf-enabled").value === "true",
      fallbackThreshold: parseFloat(document.getElementById("set-conf-threshold").value) || 0.65,
      fallbackPhrases: document.getElementById("set-conf-phrases").value.split("\\n").map((s) => s.trim()).filter(Boolean),
      clarifiers: state.settings?.confidence?.clarifiers || {},
    },
    lowConfAlertThreshold: parseInt(document.getElementById("set-lowconf-threshold").value) || 3,
    typingMsPerChar: parseInt(document.getElementById("set-typing-mschar").value) || 45,
    typingMaxMs: parseInt(document.getElementById("set-typing-maxms").value) || 4000,
    maxResponseChars: parseInt(document.getElementById("set-max-chars").value) || 500,
    maxResponseSentences: parseInt(document.getElementById("set-max-sentences").value) || 3,
    brainAnalysisEnabled: document.getElementById("set-brain-enabled").value === "true",
    brainAnalysisInterval: parseInt(document.getElementById("set-brain-interval").value) || 4,
    aiFallbackPhrases: document.getElementById("set-ai-fallbacks").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    groupReplyCooldownMs: parseInt(document.getElementById("set-group-cooldown").value) || 12000,
    returningContactDays: parseInt(document.getElementById("set-returning-days").value) || 7,
  };
}

async function saveSettings() {
  const settings = collectSettings();
  const res = await authFetch("/api/dashboard/settings", {
    method: "PUT",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(settings),
  });
  if (res.ok) { toast("Settings saved. Cache refreshes in ~30s."); fetchData(); }
  else toast("Failed to save", true);
}

async function resetSettings() {
  if (!confirm("Reset all bot settings to defaults?")) return;
  const res = await authFetch("/api/dashboard/settings/reset", {method: "POST"});
  if (res.ok) { toast("Settings reset to defaults"); fetchData(); }
}

function statCard(label, value, color) {
  return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value ' + color + '">' + value + '</div></div>';
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

let toastTimer;

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    const tab = btn.dataset.tab;
    if (tab === "settings" && !state.settings) loadSettings();
    if (tab === "conversations" && !document.querySelector("#conv-list").children.length) loadConversations();
    if (tab === "brain") loadBrainTab();
    if (tab === "commands") loadCommands();
    if (tab === "persona") loadPersonaTab();
  });
});



fetchData();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
}
