export const HTML_TAB_PERSONA = `
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
  </div>`;

export const HTML_TAB_MODELS = `
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
  </div>`;

export const HTML_TAB_USAGE = `
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
  </div>`;
