import type {BrainOutput} from "../brain/types.js";
import {BRAIN_OUTPUT_DEFAULTS} from "../brain/types.js";
import {getConversationsKv} from "../memory/index.js";
import {getBotSettings} from "../lib/bot-settings/index.js";
import {json} from "./helpers.js";

export async function getBrainOverview(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json({totalAnalyzed: 0, avgConfidence: 0, intentBreakdown: {}, sentimentBreakdown: {}, languageBreakdown: {}, contacts: []});
  const result = await kv.list({prefix: "brain:output:"});
  const contacts = await Promise.all(result.keys.map(async (key) => {
    const chatId = key.name.replace("brain:output:", "");
    const raw = await kv.get(key.name);
    if (!raw) return null;
    try {
      const output = JSON.parse(raw) as BrainOutput;
      return {chatId, output};
    } catch { return null; }
  }));
  const valid = contacts.filter(Boolean).sort((a, b) => (b!.output.lastUpdated || 0) - (a!.output.lastUpdated || 0));
  const totalAnalyzed = valid.length;
  const avgConfidence = totalAnalyzed > 0 ? valid.reduce((s, c) => s + (c!.output.lastConfidence || 1), 0) / totalAnalyzed : 0;
  const intentBreakdown: Record<string, number> = {};
  const sentimentBreakdown: Record<string, number> = {};
  const languageBreakdown: Record<string, number> = {};
  for (const c of valid) {
    const i = c!.output.intent;
    if (i) intentBreakdown[i] = (intentBreakdown[i] || 0) + 1;
    const s = c!.output.sentiment;
    if (s) sentimentBreakdown[s] = (sentimentBreakdown[s] || 0) + 1;
    const l = c!.output.detectedLanguage;
    if (l) languageBreakdown[l] = (languageBreakdown[l] || 0) + 1;
  }
  return json({totalAnalyzed, avgConfidence, intentBreakdown, sentimentBreakdown, languageBreakdown, contacts: valid});
}

export async function getBrainLowConfidence(): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv || !kv.list) return json([]);
  const settings = await getBotSettings();
  const threshold = settings.confidence.fallbackThreshold;
  const result = await kv.list({prefix: "brain:output:"});
  const low = await Promise.all(result.keys.map(async (key) => {
    const chatId = key.name.replace("brain:output:", "");
    const raw = await kv.get(key.name);
    if (!raw) return null;
    try {
      const output = JSON.parse(raw) as BrainOutput;
      const conf = output.lastConfidence ?? 1;
      if (conf >= threshold) return null;
      return {chatId, lastConfidence: conf, lastMessage: "", personaNotes: output.persona_notes || ""};
    } catch { return null; }
  }));
  const filtered = low.filter(Boolean).sort((a, b) => (a!.lastConfidence || 0) - (b!.lastConfidence || 0));
  return json(filtered);
}

export async function getBrainForChat(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const [raw, summaryRaw] = await Promise.all([
    kv.get(`brain:output:${chatId}`),
    kv.get(`brain:summary:${chatId}`),
  ]);
  const output = raw ? JSON.parse(raw) : null;
  const summary = summaryRaw || "";
  return json({output, summary});
}

export async function handleBrainPatch(chatId: string, body: string): Promise<Response> {
  const patch = JSON.parse(body) as Partial<BrainOutput>;
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  const raw = await kv.get(`brain:output:${chatId}`);
  const existing = raw ? JSON.parse(raw) as BrainOutput : {...BRAIN_OUTPUT_DEFAULTS, lastUpdated: Date.now(), facts: [], is_returning: false};
  const merged = {...existing, ...patch};
  await kv.put(`brain:output:${chatId}`, JSON.stringify(merged));
  return json({ok: true});
}

export async function handleBrainDelete(chatId: string): Promise<Response> {
  const kv = getConversationsKv();
  if (!kv) return json({error: "KV not available"}, 500);
  await Promise.all([
    kv.delete?.(`brain:output:${chatId}`),
    kv.delete?.(`brain:summary:${chatId}`),
  ]);
  return json({ok: true});
}
