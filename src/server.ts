import dotenv from "dotenv";
import express from "express";
import {webhookCallback} from "grammy/web";
import {createBot, registerPublicCommands} from "./bot.js";
import {config} from "./config.js";
import {getEnv} from "./runtime-env.js";
import {handleDashboardApi, renderDashboardPage} from "./dashboard.js";

dotenv.config();

const app = express();

app.get("/health", (_req, res) => res.json({ok: true}));

app.use("/api/dashboard", express.text(), async (req, res, next) => {
  const user = config.dashboardUsername;
  const pw = config.dashboardPassword;
  if (!user || !pw) {
    res.status(404).type("text/plain").send("Dashboard disabled. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD.");
    return;
  }
  if (req.path === "/" || req.path === "") {
    const html = await renderDashboardPage();
    res.type("html").send(html);
    return;
  }
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== `${user}:${pw}`) {
    res.status(401).send("Unauthorized");
    return;
  }
  const body = ["PUT", "POST"].includes(req.method) ? req.body : null;
  const result = await handleDashboardApi(req.path, req.method, body);
  if (result) {
    res.status(result.status).set(Object.fromEntries(result.headers)).send(await result.text());
  } else {
    res.status(404).send("Not found");
  }
});

async function main() {
  const telegramToken = getEnv("TELEGRAM_BOT_TOKEN");
  if (!telegramToken) {
    console.error(
      "TELEGRAM_BOT_TOKEN is not set. Set it in .env or as an environment variable.",
    );
    console.error(
      "Bot will not start. The /health endpoint is still available.",
    );
    return;
  }

  const bot = createBot();
  await registerPublicCommands(bot);
  const webhookUrl = getEnv("WEBHOOK_URL");

  if (webhookUrl) {
    try {
      const whUrl = `${webhookUrl.replace(/\/+$/, "")}/api/webhooks/telegram`;
      await bot.api.setWebhook(whUrl);
      app.post("/api/webhooks/telegram", webhookCallback(bot, "express"));
      console.log(`Bot webhook set to ${whUrl}`);
    } catch (err) {
      console.error("Failed to set webhook, falling back to polling:", err);
      bot.start();
    }
  } else {
    bot.start({drop_pending_updates: true});
    console.log("Bot started in polling mode — no WEBHOOK_URL set");
  }

  app.listen(config.port, () => {
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
