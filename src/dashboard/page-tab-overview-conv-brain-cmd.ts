export const HTML_TAB_OVERVIEW_CONV_BRAIN_CMD = `
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
  </div>`;
