import {getBotSettings, saveBotSettings, buildIdentityPrompt, getPersonaHistory, containsAntiPattern} from "../lib/bot-settings/index.js";
import {callGeminiWithFallback} from "../lib/gemini.js";
import {json} from "./helpers.js";

export async function handlePersonaTest(body: string): Promise<Response> {
  const {message, language} = JSON.parse(body) as {message?: string; language?: string};
  if (!message) return json({error: "message required"}, 400);
  const settings = await getBotSettings();
  const prompt = `${await buildIdentityPrompt(settings)}

Current user message (in ${language || "uz"}):
${message}

Respond with a JSON object:
{
  "text": "your natural reply",
  "confidence": 0.0-1.0,
  "is_factual_claim": true/false
}`;
  try {
    const raw = await callGeminiWithFallback(prompt);
    const cleaned = raw.replace(/```(json)?/g, "").trim();
    let replyText = raw;
    let confidence = 1.0;
    try {
      const parsed = JSON.parse(cleaned) as {text?: string; confidence?: number};
      if (parsed.text) replyText = parsed.text;
      if (typeof parsed.confidence === "number") confidence = parsed.confidence;
    } catch {}
    const detectedAntiPatterns = containsAntiPattern(replyText, settings.neverSay);
    return json({reply: replyText, confidence, detectedAntiPatterns});
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

export async function handlePersonaRevert(savedAt: string): Promise<Response> {
  const history = await getPersonaHistory();
  const entry = history.find((h) => h.savedAt === parseInt(savedAt, 10));
  if (!entry) return json({error: "snapshot not found"}, 404);
  await saveBotSettings(entry.snapshot);
  return json({ok: true});
}
