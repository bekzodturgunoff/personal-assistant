import {webhookCallback} from "grammy/web";
import {config} from "../config/env.js";
import {registerPublicCommands} from "../bot.js";
import {getBot, ensureTelegramWebhook, getTelegramDebugInfo} from "./bootstrap.js";
import {renderHomePage, renderErrorResponse} from "./pages.js";
import {handleDashboardApi, renderDashboardPage, handleNonDashboardApi} from "../dashboard/index.js";
import {processDuePendingReplies} from "../handlers/business/index.js";

type Ctx = {waitUntil(p: Promise<unknown>): void};
type Env = Record<string, unknown>;

function authOk(request: Request): boolean {
  const user = config.dashboardUsername;
  const pw = config.dashboardPassword;
  if (!user || !pw) return false;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === `${user}:${pw}`;
}

export async function handleRequest(request: Request, _env: Env, ctx: Ctx): Promise<Response> {
  try {
    const bot = getBot();
    await registerPublicCommands(bot);
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      await ensureTelegramWebhook(bot, url.origin);
      if (config.dashboardUsername && config.dashboardPassword) {
        return Response.redirect(`${url.origin}/api/dashboard`, 302);
      }
      return renderHomePage();
    }

    if (url.pathname === "/setup") {
      await ensureTelegramWebhook(bot, url.origin);
      return Response.json({ok: true, message: "Telegram webhook registered"});
    }

    if (url.pathname === "/health") {
      return Response.json({ok: true});
    }

    if (url.pathname === "/api/webhooks/telegram" && request.method === "POST") {
      const secretToken = config.webhookSecret;
      if (secretToken && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secretToken) {
        return new Response("Unauthorized", {status: 401});
      }
      const response = await webhookCallback(bot, "cloudflare-mod", {timeoutMilliseconds: 25000})(request);
      ctx.waitUntil(processDuePendingReplies());
      return response;
    }

    const NEW_API_PREFIXES = ["/api/conversations", "/api/commands", "/api/brain", "/api/persona"];
    if (NEW_API_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      if (!authOk(request)) return new Response("Unauthorized", {status: 401});
      const body = ["PUT", "POST", "PATCH"].includes(request.method) ? await request.text() : null;
      const result = await handleNonDashboardApi(url.pathname, request.method, body);
      if (result) return result;
      return new Response("Not found", {status: 404});
    }

    if (url.pathname.startsWith("/api/dashboard")) {
      if (!config.dashboardUsername || !config.dashboardPassword) {
        return new Response("Dashboard disabled. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD.", {
          status: 404,
          headers: {"content-type": "text/plain; charset=utf-8"},
        });
      }
      if (url.pathname === "/api/dashboard" || url.pathname === "/api/dashboard/") {
        return renderDashboardPage();
      }
      if (!authOk(request)) return new Response("Unauthorized", {status: 401});
      const body = ["PUT", "POST"].includes(request.method) ? await request.text() : null;
      const result = await handleDashboardApi(url.pathname, request.method, body);
      if (result) return result;
      return new Response("Not found", {status: 404});
    }

    if (config.debugEnabled) {
      if (url.pathname === "/debug/send" && request.method === "POST") {
        try {
          const body = await request.json() as {chat_id?: number; text?: string};
          if (!body.chat_id) return Response.json({error: "chat_id is required"}, {status: 400});
          const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({chat_id: body.chat_id, text: body.text || "test"}),
            signal: AbortSignal.timeout(10000),
          });
          return Response.json(await res.json());
        } catch (error) {
          console.error("Raw send error:", error);
          return Response.json({error: String(error)}, {status: 500});
        }
      }

      if (url.pathname === "/debug/telegram") {
        return getTelegramDebugInfo(bot, url.origin);
      }
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, {status: 204});
    }

    return new Response("Not found", {status: 404});
  } catch (error) {
    console.error("Worker fetch error:", error);
    return renderErrorResponse(error);
  }
}
