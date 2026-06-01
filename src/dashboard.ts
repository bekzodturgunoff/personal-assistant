import {getUsageStats, resetUsageStats} from "./lib/usage-stats.js";
import {getGeminiModels, setGeminiModels, getGroqModels, setGroqModels, DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_CHAT_MODELS, DEFAULT_GROQ_JSON_MODELS} from "./lib/model-config.js";
import {getWeeklyAccumulator} from "./lib/kv-store.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"},
  });
}

export async function handleDashboardApi(pathname: string, method: string, body: string | null): Promise<Response | null> {
  try {
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
    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

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
    },
  });
}

export function renderDashboardPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bot Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
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
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr 1fr; } body { padding: 12px; } }
</style>
</head>
<body>
<div id="login-screen" class="login-screen">
  <div class="login-box">
    <h2>Bot Dashboard</h2>
    <p style="color:#94a3b8;font-size:0.875rem;margin-bottom:16px;">Enter dashboard password</p>
    <div class="input-group" style="flex-direction:column;">
      <input type="password" id="password-input" placeholder="Password" onkeydown="if(event.key==='Enter')login()" />
    </div>
    <button class="btn primary" onclick="login()" style="width:100%;justify-content:center;">Unlock</button>
    <div id="login-error" class="error">Wrong password</div>
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

  <div id="toast" class="toast"></div>
</div>

<script>
let state = {};
let token = sessionStorage.getItem("dash_token") || "";

function getHeaders() {
  return token ? {"Authorization": "Bearer " + token, "content-type": "application/json"} : {"content-type": "application/json"};
}

function login() {
  const pw = document.getElementById("password-input").value;
  token = pw;
  sessionStorage.setItem("dash_token", token);
  fetchData().then(ok => {
    if (!ok) {
      document.getElementById("login-error").style.display = "block";
      sessionStorage.removeItem("dash_token");
      token = "";
    }
  });
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
  return res;
}

async function fetchData() {
  try {
    const res = await authFetch("/api/dashboard/data");
    if (!res.ok) return false;
    state = await res.json();
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
if (token) fetchData();

function render() {
  renderWeeklyStats();
  renderMonthlyUsage();
  renderModelStatus();
  renderGeminiUsage();
  renderGroqUsage();
  renderGeminiModels();
  renderGroqModels();
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
