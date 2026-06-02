export const HTML_HEAD = `<!doctype html>
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
      <button class="btn sm" onclick="sessionStorage.removeItem('dash_token');location.reload()" title="Lock">&#x1f512;</button>
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
  </div>`;
