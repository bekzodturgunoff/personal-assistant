import type {BotSettings} from "./types.js";
import {getBotSettings} from "./cache.js";

function buildIdentityPromptSync(settings: BotSettings): string {
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

export async function buildIdentityPrompt(settings?: BotSettings): Promise<string> {
  if (!settings) {
    settings = await getBotSettings();
  }
  return buildIdentityPromptSync(settings);
}
