export const PAGE_SCRIPT = `
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
    loadConversations();
    return true;
  } catch {
    return false;
  }
}

// Auto-refresh recent activity every 30 seconds
setInterval(() => {
  loadConversations();
}, 30000);

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
    return '<div class="conv-row" onclick="selectConversation(' + "'" + esc(c.chatId) + "'" + ')" style="padding:10px;border-bottom:1px solid #1e293b;cursor:pointer;' + (c.muted ? 'opacity:0.5;' : '') + '">' +
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
      '<button class="btn sm" onclick="toggleMute(' + "'" + esc(chatId) + "'" + ')" id="mute-btn-' + chatId + '">' + (meta.muted ? 'Unmute' : 'Mute') + '</button>' +
      '<button class="btn sm primary" onclick="showInjectModal(' + "'" + esc(chatId) + "'" + ')">Inject reply</button>' +
      '<button class="btn sm" onclick="cancelPending(' + "'" + esc(chatId) + "'" + ')">Cancel pending</button>' +
      '<button class="btn sm" onclick="runBrainNow(' + "'" + esc(chatId) + "'" + ')">Run brain</button>' +
      '<button class="btn sm danger" onclick="resetBrain(' + "'" + esc(chatId) + "'" + ')">Reset brain</button>' +
    '</div>' +
    '<div class="card" style="padding:12px;margin-bottom:12px;">' +
      '<h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:8px;">Brain Analysis</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:0.8rem;">' +
        '<div><label style="color:#64748b;">Intent</label><select onchange="patchBrainMeta(' + "'" + esc(chatId) + "'" + ',' + "'" + 'intent' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + intentOptions.map(o => '<option value="' + o + '"' + (brain.intent === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Sentiment</label><select onchange="patchBrainMeta(' + "'" + esc(chatId) + "'" + ',' + "'" + 'sentiment' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + sentimentOptions.map(o => '<option value="' + o + '"' + (brain.sentiment === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Urgency</label><select onchange="patchBrainMeta(' + "'" + esc(chatId) + "'" + ',' + "'" + 'urgency' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + urgencyOptions.map(o => '<option value="' + o + '"' + (brain.urgency === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Stage</label><select onchange="patchBrainMeta(' + "'" + esc(chatId) + "'" + ',' + "'" + 'relationship_stage' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + stageOptions.map(o => '<option value="' + o + '"' + (brain.relationship_stage === o ? ' selected' : '') + '>' + o + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Language</label><select onchange="patchBrainMeta(' + "'" + esc(chatId) + "'" + ',' + "'" + 'forcedLanguage' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;">' + langOptions.map(o => '<option value="' + o + '"' + ((meta.forcedLanguage || "") === o ? ' selected' : '') + '>' + (o || "auto") + '</option>').join("") + '</select></div>' +
        '<div><label style="color:#64748b;">Confidence</label><input type="number" value="' + (brain.lastConfidence ?? 1) + '" min="0" max="1" step="0.01" onchange="patchBrainField(' + "'" + esc(chatId) + "'" + ',' + "'" + 'lastConfidence' + "'" + ',parseFloat(this.value))" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;" /></div>' +
      '</div>' +
      (brain.persona_notes ? '<div style="margin-top:8px;"><label style="color:#64748b;font-size:0.8rem;">Persona notes</label><textarea rows="2" onchange="patchBrainField(' + "'" + esc(chatId) + "'" + ',' + "'" + 'persona_notes' + "'" + ',this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:4px 8px;color:#e2e8f0;font-size:0.8rem;font-family:monospace;">' + esc(brain.persona_notes) + '</textarea></div>' : '') +
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
        '<button class="btn primary" onclick="doInject(' + "'" + esc(chatId) + "'" + ')">Send</button>' +
        '<button class="btn" onclick="document.getElementById(' + "'" + 'inject-modal' + "'" + ').remove()">Cancel</button>' +
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
  const res = await authFetch("/api/brain/" + chatId + "/meta", {
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
      '<button class="btn sm" onclick="selectConversation(' + "'" + esc(c.chatId) + "'" + ');switchTab(' + "'" + 'conversations' + "'" + ')">View</button>' +
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
      '<tr><td><code style="color:#93c5fd;">#' + esc(c.chatId) + '</code></td><td style="color:#f87171;">' + (c.lastConfidence || 0).toFixed(2) + '</td><td style="color:#94a3b8;font-size:0.8rem;">' + esc((c.personaNotes || "").slice(0, 40)) + '</td><td><button class="btn sm" onclick="runBrainNow(' + "'" + esc(c.chatId) + "'" + ')">Run brain</button></td></tr>'
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
      '<button class="btn primary" onclick="saveBrainEditor(' + "'" + esc(chatId) + "'" + ')">Save Changes</button>' +
      '<button class="btn" onclick="runBrainNow(' + "'" + esc(chatId) + "'" + ')">Run Brain Now</button>' +
      '<button class="btn danger" onclick="resetBrain(' + "'" + esc(chatId) + "'" + ')">Reset Brain</button>' +
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
    promises.push(authFetch("/api/brain/" + chatId, {method: "PATCH", body: JSON.stringify({summary})}));
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
      '<label style="position:relative;display:inline-block;width:36px;height:20px;"><input type="checkbox" ' + (c.enabled ? 'checked' : '') + ' onchange="toggleCommand(' + "'" + esc(c.id) + "'" + ',this.checked)" style="opacity:0;width:0;height:0;"><span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:' + (c.enabled ? '#3b82f6' : '#475569') + ';border-radius:20px;transition:0.3s;"></span></label>' +
      '<button class="btn sm" onclick="editCommand(' + "'" + esc(c.id) + "'" + ')">Edit</button>' +
      '<span style="cursor:pointer;color:#ef4444;font-size:0.8rem;" onclick="deleteCommand(' + "'" + esc(c.id) + "'" + ')">✕</span>' +
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
        '<button class="btn sm" onclick="clearCooldown(' + "'" + esc(c.model) + "'" + ')">Clear</button>' +
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
  document.getElementById("set-rt-first-delay").value = rt.firstReplyDelaySeconds ?? 3;
  document.getElementById("set-rt-slow-delay").value = rt.slowReplyDelaySeconds ?? 5;
  document.getElementById("set-rt-normal-delay").value = rt.normalReplyDelaySeconds ?? 2;
  document.getElementById("set-rt-slow-threshold").value = rt.slowThresholdSeconds ?? 30;
  document.getElementById("set-rt-random-extra").value = rt.randomExtraMaxSeconds ?? 2;

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

function intVal(id, def) {
  const v = parseInt(document.getElementById(id).value, 10);
  return Number.isNaN(v) ? def : v;
}
function floatVal(id, def) {
  const v = parseFloat(document.getElementById(id).value);
  return Number.isNaN(v) ? def : v;
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
      conversationGapMinutes: intVal("set-rt-conversation-gap", 30),
      firstReplyDelaySeconds: intVal("set-rt-first-delay", 3),
      slowReplyDelaySeconds: intVal("set-rt-slow-delay", 5),
      normalReplyDelaySeconds: intVal("set-rt-normal-delay", 2),
      slowThresholdSeconds: intVal("set-rt-slow-threshold", 30),
      randomExtraMaxSeconds: intVal("set-rt-random-extra", 2),
    },
    confidence: {
      enabled: document.getElementById("set-conf-enabled").value === "true",
      fallbackThreshold: floatVal("set-conf-threshold", 0.65),
      fallbackPhrases: document.getElementById("set-conf-phrases").value.split("\\n").map((s) => s.trim()).filter(Boolean),
      clarifiers: state.settings?.confidence?.clarifiers || {},
    },
    lowConfAlertThreshold: intVal("set-lowconf-threshold", 3),
    typingMsPerChar: intVal("set-typing-mschar", 45),
    typingMaxMs: intVal("set-typing-maxms", 4000),
    maxResponseChars: intVal("set-max-chars", 500),
    maxResponseSentences: intVal("set-max-sentences", 3),
    brainAnalysisEnabled: document.getElementById("set-brain-enabled").value === "true",
    brainAnalysisInterval: intVal("set-brain-interval", 4),
    aiFallbackPhrases: document.getElementById("set-ai-fallbacks").value.split("\\n").map((s) => s.trim()).filter(Boolean),
    groupReplyCooldownMs: intVal("set-group-cooldown", 12000),
    returningContactDays: intVal("set-returning-days", 7),
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
