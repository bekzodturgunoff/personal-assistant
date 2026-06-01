// Two-layer architecture:
//   Layer 1 — Silent background analyst (this prompt)
//   Layer 2 — Groq JSON extraction (user role, single-turn)
// Returns a single JSON object. Never talks to humans.

import type {BrainProvider, BrainAnalysis, ConversationEntry} from "../types.js";
import {BRAIN_OUTPUT_DEFAULTS} from "../types.js";
import {callGroqWithFallback} from "../../lib/groq.js";

const BRAIN_PROMPT = `You are a silent background analyst. You never talk to users. Your only job is to analyze a Telegram business conversation and return a JSON object.

Conversation history:
{HISTORY}

Previous summary:
{SUMMARY}

Previously known facts:
{FACTS}

Return ONLY a valid JSON object with these exact fields:

{
  "summary": "2-3 sentences covering what has been discussed and what the client wants. Be specific.",
  "facts": ["array of NEW facts only — things not in 'previously known facts'. Format: 'Client [fact]'. Skip if nothing new."],
  "intent": "one of: price_inquiry | complaint | greeting | request | follow_up | other",
  "urgency": "one of: low | medium | high. High = client expressed time pressure or strong emotion.",
  "pending_questions": ["array of questions the client asked that Bekzod has NOT yet answered in this conversation"],
  "sentiment": "one of: positive | neutral | negative",
  "relationship_stage": "one of: stranger | acquaintance | warm_lead | regular. Base this on total message count and tone warmth."
}

ADDITIONAL ANALYSIS RULES:
- pending_questions: Be strict. Only include a question if Bekzod's last reply did NOT address it. Read the conversation carefully — if Bekzod said "men tekshirib beraman" to a question, that question IS still pending. If Bekzod gave a real answer, it is NOT pending.
- sentiment: Base this on the CLIENT's messages only, not Bekzod's. Positive = client expressed satisfaction, thanks, or enthusiasm. Negative = client expressed frustration, impatience, or complaint. Neutral = everything else.
- urgency: Set "high" if ANY of these are true: Client used time-pressure words (tez, hozir, bugun, urgent, срочно); Client sent multiple follow-up messages without a reply; Client's message contains "!!" or multiple "?"; Client expressed that they are waiting on Bekzod for something important.
- facts: Format every fact as a complete sentence starting with "Client". BAD: "likes fast replies". GOOD: "Client prefers quick replies and gets impatient with delays". BAD: "asked about price". GOOD: "Client asked about the price of [specific product] on [date context]".

Rules:
- Return ONLY the JSON. No explanation, no markdown, no backticks.
- facts must be truly new — do not repeat anything in previously known facts.
- pending_questions: only include questions that were genuinely not answered. If Bekzod replied to a question, do not include it.
- If the conversation is a simple greeting with no questions, pending_questions = [].`;

export function createGroqBrainProvider(): BrainProvider {
  return {
    async analyze(
      history: ConversationEntry[],
      currentSummary: string,
      existingFacts: string[],
    ): Promise<BrainAnalysis> {
      const historyText = history
        .map((e) => `${e.role === "user" ? "Person" : "You"}: ${e.text}`)
        .join("\n");

      const factsText = existingFacts.length > 0
        ? existingFacts.map((f) => `- ${f}`).join("\n")
        : "None";

      const summaryText = currentSummary || "None";

      const prompt = BRAIN_PROMPT
        .replace("{FACTS}", factsText)
        .replace("{SUMMARY}", summaryText)
        .replace("{HISTORY}", historyText);

      const messages = [
        {role: "user" as const, content: prompt},
      ];

      console.log(`[Brain/Groq] Analyzing conversation (${history.length} entries)...`);

      try {
        const raw = await callGroqWithFallback(messages, true);
        const cleaned = raw.replace(/```(json)?/g, "").trim();
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;

        const merged: BrainAnalysis = {
          ...BRAIN_OUTPUT_DEFAULTS,
          summary: typeof parsed.summary === "string" ? parsed.summary : currentSummary,
          newFacts: Array.isArray(parsed.facts) ? parsed.facts as string[] : [],
        };

        if (typeof parsed.intent === "string" && ["price_inquiry", "complaint", "greeting", "request", "follow_up", "other"].includes(parsed.intent)) {
          merged.intent = parsed.intent as BrainAnalysis["intent"];
        }
        if (typeof parsed.urgency === "string" && ["low", "medium", "high"].includes(parsed.urgency)) {
          merged.urgency = parsed.urgency as BrainAnalysis["urgency"];
        }
        if (Array.isArray(parsed.pending_questions)) {
          merged.pending_questions = parsed.pending_questions as string[];
        }
        if (typeof parsed.sentiment === "string" && ["positive", "neutral", "negative"].includes(parsed.sentiment)) {
          merged.sentiment = parsed.sentiment as BrainAnalysis["sentiment"];
        }
        if (typeof parsed.relationship_stage === "string" && ["stranger", "acquaintance", "warm_lead", "regular"].includes(parsed.relationship_stage)) {
          merged.relationship_stage = parsed.relationship_stage as BrainAnalysis["relationship_stage"];
        }

        return merged;
      } catch (err) {
        console.error("[Brain/Groq] Analysis failed:", err);
        return {...BRAIN_OUTPUT_DEFAULTS, summary: currentSummary};
      }
    },
  };
}
