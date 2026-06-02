import type {BotSettings, BotCommandEntry} from "./types.js";
import personaDefaults from "../../persona.json" with {type: "json"};

export function generateCommandId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function containsAntiPattern(reply: string, neverSay: string[]): string[] {
  return neverSay.filter((p) => reply.toLowerCase().includes(p.toLowerCase()));
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
      {id: generateCommandId(), name: "mute", description: "Stop the bot", instruction: "", generatedPrompt: "", enabled: true, createdAt: Date.now(), lastTestedAt: null, lastTestOutput: null},
      {id: generateCommandId(), name: "unmute", description: "Resume the bot", instruction: "", generatedPrompt: "", enabled: true, createdAt: Date.now(), lastTestedAt: null, lastTestOutput: null},
      {id: generateCommandId(), name: "remind", description: "Set a reminder", instruction: "", generatedPrompt: "", enabled: true, createdAt: Date.now(), lastTestedAt: null, lastTestOutput: null},
    ],
    objectionHandling: (p.objection_handling as Record<string, string>) || {},
    skipReplyPatterns: (p.skip_reply_patterns as string[]) || [],
    replyTiming: {
      conversationGapMinutes: 30,
      firstReplyDelaySeconds: 3,
      slowReplyDelaySeconds: 5,
      normalReplyDelaySeconds: 2,
      slowThresholdSeconds: 30,
      randomExtraMaxSeconds: 2,
    },
    confidence: {
      enabled: true,
      fallbackThreshold: 0.65,
      fallbackPhrases: [
        "men tekshirib beraman",
        "aniqlab beraman, biroz kuting",
        "hozir bilib olaman",
      ],
      clarifiers: {
        price_inquiry: [
          "Bu qaysi mahsulot uchun edi?",
          "Qancha miqdor kerak edi?",
          "Qachonga kerak?",
        ],
        request: [
          "Aniqroq aytib bera olasizmi?",
          "Qachonga kerak?",
        ],
      },
    },
    lowConfAlertThreshold: 3,
    typingMsPerChar: 45,
    typingMaxMs: 4000,
    groupReplyCooldownMs: 12000,
    maxResponseChars: 500,
    maxResponseSentences: 3,
    brainAnalysisInterval: 4,
    brainAnalysisEnabled: true,
    aiFallbackPhrases: [
      "Hozir bandman, keyinroq javob beraman",
      "Sal gaplashamiz keyin, hozir ish bilan bandman",
      "Keyinroq yozaman, hozir biroz band",
      "Hozir qo'lim tegmayapti, keyin albatta javob beraman",
      "Hozir boshqa ish bilan bandman, keyin yozaman",
    ],
    returningContactDays: 7,
  };
}
