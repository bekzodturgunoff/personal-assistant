export function renderHomePage(): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bekzod's Assistant</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
      main { max-width: 640px; padding: 32px; text-align: center; }
      .card { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 20px; padding: 32px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
      h1 { margin: 0 0 12px; font-size: 2.5rem; }
      p { margin: 0.5rem 0; line-height: 1.6; color: #cbd5e1; }
      code { background: rgba(148, 163, 184, 0.16); padding: 0.2rem 0.45rem; border-radius: 8px; }
      .ok { color: #4ade80; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Bekzod's Assistant</h1>
        <p class="ok">Running on Cloudflare Workers</p>
        <p>This is the bot backend, not a public website.</p>
        <p>Health: <code>/health</code></p>
        <p>Telegram webhook: <code>/api/webhooks/telegram</code></p>
      </div>
    </main>
  </body>
</html>`;
  return new Response(html, {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
}

export function renderErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(`Assistant error: ${message}`, {
    status: 500,
    headers: {"content-type": "text/plain; charset=utf-8"},
  });
}
