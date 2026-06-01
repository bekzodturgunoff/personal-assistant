import {getLongTermKv} from "./kv-store.js";
import personaDefaults from "../persona.json" with {type: "json"};

const SETTINGS_KEY = "_settings";

export interface BotSettings {
  name: string;
  ownerName: string;
  background: {
    from: string;
    timezone: string;
    work: string;
    style: string;
    languages: string[];
  };
  voice: Record<string, unknown>;
  timePersonality: Record<string, string>;
  absoluteRules: string[];
  behaviorRules: string[];
  fallbackRules: string[];
  neverSay: string[];
  speechPatterns: Record<string, string[]>;
  businessMode: {
    contact: string[];
    tone: string;
  };
  commands: Array<{command: string; description: string}>;
  objectionHandling: Record<string, string>;
  skipReplyPatterns: string[];
}

export function getDefaultSettings(): BotSettings {
  const p = personaDefaults as Record<string, unknown>;
  return {
    name: "Bekzod",
    ownerName: "Bekzod",
    background: {
      from: "Namangan, Uzbekistan",
      timezone: "Asia/Tashkent (UTC+5)",
      work: "Founder / builder running multiple projects",
      style: "Samimiy, takalluf bilan. Namangancha — yumshoq, muloyim.",
      languages: ["Uzbek (Namangan dialect)", "Russian", "English"],
    },
    voice: (p.voice as Record<string, unknown>) || {},
    timePersonality: (p.time_personality as Record<string, string>) || {},
    absoluteRules: [
      "Never say you are an AI or a bot under any circumstances",
      "Never apologize excessively — one brief acknowledgment is enough",
      "Never use formal closings like 'Hurmat bilan' unless the other person used them first",
      "Never make up prices, deadlines, or commitments you are not sure about",
      "If unsure about a fact, use one of: 'men tekshirib beraman' / 'aniqlab beraman' / 'hozir bilib olaman'",
      "Max 2-3 sentences per reply unless they asked a complex question",
      "Match their exact language (Uzbek / Russian / English / mixed)",
      "Never end a sentence with a period/dot — write like a real person texting",
      "Don't acknowledge time gaps or reply timing — just reply naturally as if no time passed",
      "Never use filler phrases like 'Great question!' or 'Certainly!'",
      "If someone asks for your contact or how to reach you, share: https://itsbek.me/ or your phone number +998501886669",
      "Always follow the REPLY_LENGTH instruction above. Never write more than instructed unless the client explicitly asked a multi-part question.",
    ],
    behaviorRules: (p.behavior_rules as string[]) || [],
    fallbackRules: (p.fallback_rules as string[]) || [],
    neverSay: ((p.speech_patterns as Record<string, unknown>)?.never_say as string[]) || [],
    speechPatterns: (p.speech_patterns as Record<string, string[]>) || {},
    businessMode: (p.business_mode as {contact: string[]; tone: string}) || {contact: [], tone: ""},
    commands: [
      {command: "mute", description: "Stop the bot"},
      {command: "unmute", description: "Resume the bot"},
      {command: "remind", description: "Set a reminder"},
    ],
    objectionHandling: (p.objection_handling as Record<string, string>) || {},
    skipReplyPatterns: (p.skip_reply_patterns as string[]) || [],
  };
}

export async function getBotSettings(): Promise<BotSettings> {
  const kv = getLongTermKv();
  if (!kv) return getDefaultSettings();
  try {
    const raw = await kv.get(SETTINGS_KEY);
    if (!raw) return getDefaultSettings();
    const saved = JSON.parse(raw) as Partial<BotSettings>;
    const defaults = getDefaultSettings();
    return {...defaults, ...saved};
  } catch {
    return getDefaultSettings();
  }
}

export async function saveBotSettings(settings: BotSettings): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  await kv.put(SETTINGS_KEY, JSON.stringify(settings));
}

export async function buildIdentityPrompt(settings: BotSettings): Promise<string> {
  const neverSayBlock = settings.neverSay.length > 0
    ? settings.neverSay.map((s) => `- Never say: "${s}"`).join("\n")
    : "";

  const timePersonalityBlock = Object.keys(settings.timePersonality).length > 0
    ? Object.entries(settings.timePersonality)
        .map(([slot, desc]) => `    ${slot} → "${desc}"`)
        .join("\n")
    : "";

  return `
You are ${settings.name}. You reply as yourself — a real person, not an AI.

BACKGROUND:
- Name: ${settings.name}
- From: ${settings.background.from}
- Timezone: ${settings.background.timezone}
- Work: ${settings.background.work}
- Style: ${settings.background.style}
- Languages: ${settings.background.languages.join(", ")}

VOICE:
${JSON.stringify(settings.voice, null, 2)}

TIME PERSONALITY (adjust tone based on time of day):
${timePersonalityBlock}

ABSOLUTE RULES:
${settings.absoluteRules.map((r) => `- ${r}`).join("\n")}
${neverSayBlock}

RESPONSE FORMAT (always return valid JSON):
{
  "text": "your reply here",
  "confidence": 0.0-1.0,
  "is_factual_claim": true/false
}

confidence guide:
  1.0 = greeting, casual reply, no facts involved
  0.8 = general knowledge you are sure about
  0.6 = something you half-remember or are inferring
  0.4 = specific price, date, or commitment you are guessing
Set is_factual_claim: true whenever text contains a price, date, 
delivery time, product spec, or any hard commitment.
`.trim();
}
