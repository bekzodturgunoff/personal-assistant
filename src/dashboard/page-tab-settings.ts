export const HTML_TAB_SETTINGS = `
  <div id="tab-settings" class="tab-content">
    <div class="card">
      <div class="card-header">
        <h2>Bot Identity</h2>
        <button class="btn sm" onclick="resetSettings()">Reset to Defaults</button>
      </div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">Changes take effect within ~30 seconds (settings cache TTL).</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Bot Name</label><input type="text" id="set-name" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Owner Name</label><input type="text" id="set-owner" /></div>
      </div>
      <div style="margin-top:12px;"><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Location</label><input type="text" id="set-from" /></div>
      <div style="margin-top:12px;"><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Work</label><input type="text" id="set-work" /></div>
      <div style="margin-top:12px;"><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Style</label><input type="text" id="set-style" /></div>
      <div style="margin-top:12px;"><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Languages (comma separated)</label><input type="text" id="set-languages" /></div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Absolute Rules</h2></div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">One rule per line. These shape the AI's behavior.</p>
      <textarea id="set-absolute-rules" rows="8" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header"><h2>Never Say (banned phrases)</h2></div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">One phrase per line. The AI will avoid these entirely.</p>
      <textarea id="set-never-say" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header"><h2>Behavior Rules</h2></div>
      <textarea id="set-behavior-rules" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header"><h2>Fallback Rules</h2></div>
      <textarea id="set-fallback-rules" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header"><h2>Contact Info (Business Mode)</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Contact (one per line)</label><textarea id="set-contact" rows="3" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Business Tone</label><input type="text" id="set-business-tone" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Reply Timing</h2></div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">Controls how long the bot waits before replying. All values in seconds unless noted.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Conversation gap (minutes)</label><input type="number" id="set-rt-conversation-gap" min="1" max="1440" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">First reply delay (sec)</label><input type="number" id="set-rt-first-delay" min="0" max="3600" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Slow replier delay (sec)</label><input type="number" id="set-rt-slow-delay" min="0" max="3600" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Normal reply delay (sec)</label><input type="number" id="set-rt-normal-delay" min="0" max="3600" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Slow threshold (sec)</label><input type="number" id="set-rt-slow-threshold" min="0" max="3600" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Random extra max (sec)</label><input type="number" id="set-rt-random-extra" min="0" max="600" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Confidence Scorer</h2></div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:12px;">When confidence is below threshold AND the AI made a factual claim, it falls back to a safe phrase.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Enabled</label><select id="set-conf-enabled" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;"><option value="true">Yes</option><option value="false">No</option></select></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Fallback threshold (0.0-1.0)</label><input type="number" id="set-conf-threshold" min="0" max="1" step="0.01" /></div>
      </div>
      <div style="margin-bottom:12px;"><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Fallback phrases (one per line)</label><textarea id="set-conf-phrases" rows="3" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea></div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Low Confidence Alerts</h2></div>
      <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Alert threshold (consecutive low-conf replies before owner notified)</label><input type="number" id="set-lowconf-threshold" min="1" max="20" /></div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Typing Simulation</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">ms per character</label><input type="number" id="set-typing-mschar" min="0" max="500" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max typing duration (ms)</label><input type="number" id="set-typing-maxms" min="0" max="30000" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>AI Response Limits</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max characters</label><input type="number" id="set-max-chars" min="50" max="4000" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Max sentences</label><input type="number" id="set-max-sentences" min="1" max="20" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Brain Analysis</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Enabled</label><select id="set-brain-enabled" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;"><option value="true">Yes</option><option value="false">No</option></select></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Analysis interval (every N user messages)</label><input type="number" id="set-brain-interval" min="1" max="50" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>AI Fallback Messages</h2></div>
      <p style="color:#64748b;font-size:0.8rem;margin-bottom:8px;">When AI calls completely fail, one of these is sent randomly.</p>
      <textarea id="set-ai-fallbacks" rows="4" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 12px;color:#e2e8f0;font-size:0.875rem;font-family:monospace;resize:vertical;"></textarea>
    </div>

    <div class="card">
      <div class="card-header"><h2>Other</h2></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Group reply cooldown (ms)</label><input type="number" id="set-group-cooldown" min="0" max="60000" /></div>
        <div><label style="color:#94a3b8;font-size:0.8rem;display:block;margin-bottom:4px;">Returning contact (days)</label><input type="number" id="set-returning-days" min="1" max="365" /></div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px;">
      <button class="btn primary" onclick="saveSettings()">Save All Settings</button>
    </div>
  </div>

  <div id="toast" class="toast"></div>
</div>`;
