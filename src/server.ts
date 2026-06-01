import dotenv from "dotenv";
import express from "express";
import {webhookCallback} from "grammy/web";
import {createBot, registerPublicCommands} from "./bot.js";
import {config} from "./config.js";
import {getEnv} from "./runtime-env.js";

dotenv.config();

const app = express();

app.get("/health", (_req, res) => res.json({ok: true}));

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
