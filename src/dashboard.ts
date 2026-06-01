import {getUsageStats, resetUsageStats} from "./lib/usage-stats.js";
import {getGeminiModels, setGeminiModels, getGroqModels, setGroqModels, DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_CHAT_MODELS, DEFAULT_GROQ_JSON_MODELS} from "./lib/model-config.js";
import {getWeeklyAccumulator, saveWeeklyAccumulator, getUserMeta, getLongTermKv, getConversationsKv, getModelCooldownKv, deleteLongTermKey, deleteConversationsKey, setPausedUntil, clearPausedUntil} from "./lib/kv-store.js";
import {getPersona} from "./persona-memory.js";
import {getConversationSummary, getBrainOutput, runBrainAnalysis} from "./brain/brain.js";
import type {UserMeta} from "./lib/kv-store.js";
import {getBotSettings, saveBotSettings, getDefaultSettings} from "./lib/bot-settings.js";
import type {BotSettings} from "./lib/bot-settings.js";

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

    if (pathname === "/api/dashboard/settings/reset" && method === "POST") {
      await saveBotSettings(getDefaultSettings());
      return json({ok: true});
    }

    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

// ── New: conversations list ──
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

  const geminiTotal = Object.values(usage.gemini).reduce(
    (acc, m) => ({inputTokens: acc.inputTokens + m.inputTokens, outputTokens: acc.outputTokens + m.outputTokens, calls: acc.calls + m.calls}),
    {inputTokens: 0, outputTokens: 0, calls: 0},
  );

  const groqTotal = Object.values(usage.groq).reduce(
    (acc, m) => ({inputTokens: acc.inputTokens + m.inputTokens, outputTokens: acc.outputTokens + m.outputTokens, calls: acc.calls + m.calls}),
    {inputTokens: 0, outputTokens: 0, calls: 0},
  );

  const kvWritesEstimated = weekly.totalMessages * 3 + weekly.brainRunCount * 2;
  const kvWritePercent = Math.min(Math.round((kvWritesEstimated / 1000) * 100), 100);

  const modelsInCooldown = 0; // will be fetched by health endpoint

  const topIntent = Object.entries(weekly.intentBreakdown).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
  const topLang = Object.entries(weekly.languageBreakdown).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
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

  <div class="tab-bar">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="models">Models</button>
    <button class="tab" data-tab="usage">Usage</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>

  <div id="tab-overview" class="tab-content active">
    <div class="card">
      <h2>Weekly Stats</h2>
      <div class="grid" id="weekly-stats"></div>
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
        <h2>Bot Commands</h2>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">These commands are registered with Telegram. Changes visible after next command registration.</p>
      <div id="commands-list"></div>
      <div class="input-group" style="margin-top:8px;">
        <input type="text" id="cmd-command" placeholder="command_name (no slash)" style="flex:1;" />
        <input type="text" id="cmd-desc" placeholder="Description" style="flex:2;" />
        <button class="btn primary sm" onclick="addCommand()">+ Add</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Voice & Personality</h2>
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Tone</label>
        <input type="text" id="set-voice-tone" />
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Humor</label>
        <input type="text" id="set-voice-humor" />
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Style</label>
        <input type="text" id="set-voice-style" />
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Language</label>
        <input type="text" id="set-voice-language" />
      </div>
      <div>
        <label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Features (one per line)</label>
        <textarea id="set-voice-features" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
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
  if (state.settings) renderSettings(state.settings);
  document.getElementById("month-display").textContent = "Month: " + (state.usage?.month || "—");
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
    groqJson.map((m) => '<span class="model-tag">' + esc(m) + '</span>').join("") + '</div>';
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

  document.getElementById("set-voice-tone").value = s.voice?.tone || "";
  document.getElementById("set-voice-humor").value = s.voice?.humor || "";
  document.getElementById("set-voice-style").value = s.voice?.style || "";
  document.getElementById("set-voice-language").value = s.voice?.language || "";
  document.getElementById("set-voice-features").value = (s.voice?.features || []).join("\\n");

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

  renderCommands(s.commands || []);
}

let settingsCommands = [];

function renderCommands(cmds) {
  settingsCommands = cmds.slice();
  const el = document.getElementById("commands-list");
  if (cmds.length === 0) {
    el.innerHTML = '<span style="color:#64748b;">No custom commands configured</span>';
    return;
  }
  el.innerHTML = cmds.map((c, i) =>
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1e293b;">' +
    '<code style="background:#0f172a;padding:2px 8px;border-radius:4px;color:#93c5fd;">/' + esc(c.command) + '</code>' +
    '<span style="flex:1;color:#94a3b8;">' + esc(c.description) + '</span>' +
    '<span style="cursor:pointer;color:#ef4444;font-size:0.8rem;" onclick="removeCommand(' + i + ')">✕</span>' +
    '</div>'
  ).join("");
}

function addCommand() {
  const cmd = document.getElementById("cmd-command").value.trim();
  const desc = document.getElementById("cmd-desc").value.trim();
  if (!cmd || !desc) return toast("Both command and description required", true);
  if (settingsCommands.find((c) => c.command === cmd)) return toast("Command already exists", true);
  settingsCommands.push({command: cmd, description: desc});
  document.getElementById("cmd-command").value = "";
  document.getElementById("cmd-desc").value = "";
  renderCommands(settingsCommands);
  toast("Command added — save to persist");
}

function removeCommand(i) {
  settingsCommands.splice(i, 1);
  renderCommands(settingsCommands);
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
    voice: {
      tone: document.getElementById("set-voice-tone").value.trim(),
      humor: document.getElementById("set-voice-humor").value.trim(),
      style: document.getElementById("set-voice-style").value.trim(),
      language: document.getElementById("set-voice-language").value.trim(),
      features: document.getElementById("set-voice-features").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    },
    absoluteRules: document.getElementById("set-absolute-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    neverSay: document.getElementById("set-never-say").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    behaviorRules: document.getElementById("set-behavior-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    fallbackRules: document.getElementById("set-fallback-rules").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    businessMode: {
      contact: document.getElementById("set-contact").value.split("\\n").map((s) => s.trim()).filter(Boolean),
      tone: document.getElementById("set-business-tone").value.trim(),
    },
    commands: settingsCommands,
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
    if (btn.dataset.tab === "settings" && !state.settings) {
      loadSettings();
    }
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
