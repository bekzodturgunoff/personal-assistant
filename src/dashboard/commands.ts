import {getBotSettings, saveBotSettings, generateCommandId} from "../lib/bot-settings/index.js";
import type {BotCommandEntry} from "../lib/bot-settings/index.js";
import {callGeminiWithFallback} from "../lib/gemini.js";
import {getConversationsKv} from "../memory/index.js";
import {config} from "../config/env.js";
import {json} from "./helpers.js";

export async function handleCommandGenerate(body: string): Promise<Response> {
  const {name, description, instruction} = JSON.parse(body) as {name?: string; description?: string; instruction?: string};
  if (!name || !description || !instruction) return json({error: "name, description, instruction required"}, 400);
  const metaPrompt = `You are building a Telegram bot command handler. The command is /${name}.
Description: ${description}
The owner wants this command to: ${instruction}

The bot has access to:
- Full conversation history for all contacts (KV: chat:{id})
- Brain analysis output per contact (KV: brain:output:{id})
- UserMeta per contact (KV: meta:{id})
- Long-term memory per contact (KV: memory:{id})
- Weekly analytics accumulator (KV: analytics:current)
- Task list (KV: tasks:{user_id})

Generate a complete system prompt that this command will use when triggered.
The prompt should tell the AI exactly what data to retrieve, how to process it,
and what format to reply in. Be specific and concrete.
Return only the system prompt text, nothing else.`;
  try {
    const generatedPrompt = await callGeminiWithFallback(metaPrompt);
    return json({generatedPrompt});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

export async function handleCommandTest(body: string): Promise<Response> {
  const {generatedPrompt, name} = JSON.parse(body) as {generatedPrompt?: string; name?: string};
  if (!generatedPrompt) return json({error: "generatedPrompt required"}, 400);
  const kv = getConversationsKv();
  let sampleContext = "No recent conversations.";
  if (kv && kv.list) {
    try {
      const keys = await kv.list({prefix: "chat:"});
      const samples = await Promise.all(keys.keys.slice(0, 3).map(async (k) => {
        const raw = await kv.get(k.name);
        if (!raw) return "";
        const entries = JSON.parse(raw).slice(-5);
        return entries.map((e: {role: string; text: string}) => `${e.role}: ${e.text}`).join("\n");
      }));
      sampleContext = samples.filter(Boolean).join("\n\n---\n\n") || sampleContext;
    } catch {}
  }
  const prompt = `${generatedPrompt}\n\nRecent conversation context:\n${sampleContext}\n\nRespond as the bot for command /${name || "test"}.`;
  try {
    const output = await callGeminiWithFallback(prompt);
    return json({output});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

export async function handleCommandCreate(body: string): Promise<Response> {
  const data = JSON.parse(body) as Omit<BotCommandEntry, "id" | "createdAt">;
  const id = generateCommandId();
  const cmd: BotCommandEntry = {...data, id, createdAt: Date.now()};
  const settings = await getBotSettings();
  settings.commands.push(cmd);
  await saveBotSettings(settings);
  return json({ok: true, id});
}

export async function handleCommandUpdate(id: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<BotCommandEntry>;
  const settings = await getBotSettings();
  const idx = settings.commands.findIndex((c) => c.id === id);
  if (idx === -1) return json({error: "not found"}, 404);
  settings.commands[idx] = {...settings.commands[idx], ...patch};
  await saveBotSettings(settings);
  return json({ok: true});
}

export async function handleCommandDelete(id: string): Promise<Response> {
  const settings = await getBotSettings();
  settings.commands = settings.commands.filter((c) => c.id !== id);
  await saveBotSettings(settings);
  return json({ok: true});
}

export async function handleCommandRegister(): Promise<Response> {
  const settings = await getBotSettings();
  const enabled = settings.commands.filter((c) => c.enabled);
  const cmds = enabled.map((c) => ({command: c.name, description: c.description}));
  const tgUrl = `https://api.telegram.org/bot${config.telegramBotToken}/setMyCommands`;
  const res = await fetch(tgUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({commands: cmds}),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text();
    return json({error: `Telegram API: ${err}`}, 500);
  }
  return json({ok: true});
}
