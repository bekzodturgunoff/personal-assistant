// INTELLIGENCE: time-aware personality, reply length matching, ranked facts, objection handling, returning contact detection

// Two-layer prompting architecture:
//   Layer 1 — IDENTITY_PROMPT (module-level const, built once at cold start)
//   Layer 2 — buildDynamicContext (per-message, injected as user-turn prefix)
// The two are concatenated at call time and sent to Gemini as a single prompt.

import {callGeminiStructured, limitResponse} from "../lib/gemini.js";
import type {GeminiResponse} from "../lib/gemini.js";
import {formatTashkentTime} from "../lib/reply-timing.js";
import persona from "../persona.json" with {type: "json"};

const NEVER_SAY_BLOCK = persona.speech_patterns?.never_say
  ? persona.speech_patterns.never_say.map((s: string) => `- Never say: "${s}"`).join("\n")
  : "";

const TIME_PERSONALITY_BLOCK = persona.time_personality
  ? Object.entries(persona.time_personality)
      .map(([slot, desc]) => `    ${slot} → "${desc}"`)
      .join("\n")
  : "";

const IDENTITY_PROMPT = `
You are Bekzod. You reply as yourself — a real person, not an AI.

BACKGROUND:
- Name: Bekzod
- From: Namangan, Uzbekistan
- Timezone: Tashkent (UTC+5)
- Work: Founder / builder running multiple projects
- Style: Samimiy, takalluf bilan. Namangancha — yumshoq, muloyim.
- Languages: Uzbek (Namangan dialect), Russian, English

VOICE:
${JSON.stringify(persona.voice, null, 2)}

TIME PERSONALITY (adjust tone based on time of day):
${TIME_PERSONALITY_BLOCK}

ABSOLUTE RULES:
- Never say you are an AI or a bot under any circumstances
- Never apologize excessively — one brief acknowledgment is enough
- Never use formal closings like "Hurmat bilan" unless the other person used them first
- Never make up prices, deadlines, or commitments you are not sure about
- If unsure about a fact, use one of: "men tekshirib beraman" / "aniqlab beraman" / "hozir bilib olaman"
- Max 2-3 sentences per reply unless they asked a complex question
- Match their exact language (Uzbek / Russian / English / mixed)
- Never end a sentence with a period/dot — write like a real person texting
- Don't acknowledge time gaps or reply timing — just reply naturally as if no time passed
- Never use filler phrases like "Great question!" or "Certainly!"
- If someone asks for your contact or how to reach you, share: https://itsbek.me/ or your phone number +998501886669
- Always follow the REPLY_LENGTH instruction above. Never write more than instructed unless the client explicitly asked a multi-part question.
${NEVER_SAY_BLOCK}

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

export interface ReplyContext {
  contactName: string;
  daysKnown: number;
  messageCount: number;
  relationshipStage: string;
  brainSummary: string;
  topFacts: string[];
  sentiment: string;
  intent: string;
  urgency: string;
  detectedLanguage: string;
  pendingQuestions: string[];
  forcedLanguage?: string;
  forcedTone?: string;
  isReturning?: boolean;
  daysSinceLastContact?: number;
}

function getTashkentHour(): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tashkent",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10,
    );
  } catch {
    return new Date().getHours();
  }
}

function getTimeMood(tashkentHour: number): string {
  if (tashkentHour >= 7 && tashkentHour < 11) return "morning";
  if (tashkentHour >= 11 && tashkentHour < 14) return "midday";
  if (tashkentHour >= 14 && tashkentHour < 18) return "afternoon";
  if (tashkentHour >= 18 && tashkentHour < 22) return "evening";
  return "night";
}

function getReplyLengthHint(clientMessageText: string): string {
  const words = clientMessageText.trim().split(/\s+/).length;
  if (words <= 4) return "short — max 1 sentence, no more";
  if (words <= 15) return "medium — 1 to 2 sentences";
  return "normal — 2 to 3 sentences, match their detail level";
}

function rankFacts(facts: string[], currentMessage: string, intent: string): string[] {
  try {
    const msg = currentMessage.toLowerCase();
    const scored = facts.map((fact) => {
      let score = 0;
      const f = fact.toLowerCase();
      const msgWords = msg.split(/\s+/).filter((w) => w.length > 3);
      msgWords.forEach((word) => {
        if (f.includes(word)) score += 2;
      });
      if (intent === "price_inquiry" && (f.includes("narx") || f.includes("price") || f.includes("budget"))) score += 3;
      if (intent === "complaint" && (f.includes("muammo") || f.includes("problem") || f.includes("issue"))) score += 3;
      if (intent === "request" && (f.includes("so'ragan") || f.includes("request") || f.includes("asked"))) score += 2;
      return {fact, score};
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((s) => s.fact);
  } catch (e) {
    console.error("[rankFacts] error:", e);
    return facts.slice(0, 5);
  }
}

function toneInstructionForStage(stage: string): string {
  switch (stage) {
    case "stranger":
      return "Be polite and slightly formal. They don't know you well.";
    case "acquaintance":
      return "Be friendly and professional. You've spoken before.";
    case "warm_lead":
      return "Be relaxed and genuinely helpful. Show real interest.";
    case "regular":
      return "Be casual and direct. Talk like a friend.";
    default:
      return "Be polite and natural.";
  }
}

function buildDynamicContext(
  ctx: ReplyContext,
  tashkentTime: string,
  dayOfWeek: string,
  userMessage?: string,
): string {
  const parts: string[] = ["[CONTEXT]"];

  const tashkentHour = getTashkentHour();
  const timeMood = getTimeMood(tashkentHour);
  parts.push(`Time: ${tashkentTime} (${dayOfWeek}) — mood: ${timeMood}`);
  parts.push(`Person: ${ctx.contactName} | Known ${ctx.daysKnown} days | ${ctx.messageCount} messages | ${ctx.relationshipStage}`);

  if (ctx.brainSummary) {
    parts.push(`Summary: ${ctx.brainSummary}`);
  }

  if (ctx.topFacts.length > 0 && userMessage) {
    const ranked = rankFacts(ctx.topFacts, userMessage, ctx.intent);
    if (ranked.length > 0) {
      parts.push(`Facts: ${ranked.join(" | ")}`);
    }
  } else if (ctx.topFacts.length > 0) {
    parts.push(`Facts: ${ctx.topFacts.slice(0, 5).join(" | ")}`);
  }

  parts.push(`Signal: ${ctx.sentiment} sentiment | ${ctx.intent} intent | ${ctx.urgency} urgency`);

  const lang = ctx.forcedLanguage || ctx.detectedLanguage;
  if (ctx.forcedLanguage) {
    parts.push(`Language: Respond in ${lang} only (FORCED LANGUAGE: ${lang})`);
  } else {
    parts.push(`Language: Respond in ${lang} only`);
  }

  if (ctx.pendingQuestions.length > 0) {
    parts.push(`Still unanswered from them: ${ctx.pendingQuestions.join("; ")}`);
  }

  if (ctx.isReturning && ctx.daysSinceLastContact && ctx.daysSinceLastContact > 0) {
    parts.push(`RETURNING_CONTACT: true — they haven't messaged in ${ctx.daysSinceLastContact} days. Acknowledge the gap naturally. Reference what you last discussed if relevant. Don't be weird about it — just be warm, like a real person would.`);
  }

  if (userMessage) {
    parts.push(`REPLY_LENGTH: ${getReplyLengthHint(userMessage)}`);
  }

  parts.push("[/CONTEXT]");

  let tone: string;
  if (ctx.forcedTone) {
    switch (ctx.forcedTone) {
      case "formal":
        tone = "Be polite, professional, and slightly distant.";
        break;
      case "casual":
        tone = "Be relaxed, friendly, talk like peers.";
        break;
      case "warm":
        tone = "Be genuinely warm and personal, like a trusted friend.";
        break;
      default:
        tone = toneInstructionForStage(ctx.relationshipStage);
    }
  } else {
    tone = toneInstructionForStage(ctx.relationshipStage);
  }
  parts.push(`\nTone: ${tone}`);

  return parts.join("\n");
}

export async function businessAssistantReply(
  userMessage: string,
  historyEntries: Array<{role: "user" | "assistant"; text: string; timestamp?: number}>,
  context: ReplyContext,
): Promise<GeminiResponse> {
  const tashkentTime = formatTashkentTime();
  const dayOfWeek = new Date().toLocaleDateString("en-US", {weekday: "long"});

  const dynamicBlock = buildDynamicContext(context, tashkentTime, dayOfWeek, userMessage);

  const isObjection = context.intent === "complaint" && context.sentiment === "negative";

  const parts: string[] = [
    IDENTITY_PROMPT,
    "",
    dynamicBlock,
    "",
  ];

  if (isObjection) {
    parts.push("⚠️ OBJECTION MODE — client is unhappy.");
    parts.push("Follow this exact structure:");
    parts.push("1. First sentence: acknowledge their specific frustration (not generic \"sorry\")");
    parts.push("2. Second sentence: show you understand the impact on them");
    parts.push("3. Third sentence (if needed): offer ONE concrete next step");
    parts.push("Never: get defensive, list multiple options, use \"Hurmat bilan\", over-apologize.");
    parts.push("");
  }

  parts.push("RECENT CHAT HISTORY:");

  const recentCount = Math.min(historyEntries.length, 10);
  const recent = historyEntries.slice(-recentCount);
  for (const e of recent) {
    const speaker = e.role === "user" ? (context.contactName || "Person") : "You";
    parts.push(`${speaker}: ${e.text}`);
  }

  parts.push(
    `\n${context.contactName || "Person"} says:`,
    userMessage,
    "\nReply:",
  );

  const finalPrompt = parts.join("\n");

  console.log(`[BusinessAssistant] calling Gemini — ${context.contactName || "?"}, ${context.relationshipStage}, "${userMessage.slice(0, 80)}"`);

  const result = await callGeminiStructured(finalPrompt);

  result.text = limitResponse(result.text, 500, 3);
  console.log(`[BusinessAssistant] response ready — ${result.text.slice(0, 80)}... (conf=${result.confidence}, factual=${result.isFactualClaim})`);
  return result;
}
