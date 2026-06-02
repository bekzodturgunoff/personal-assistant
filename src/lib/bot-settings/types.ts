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
  commands: Array<BotCommandEntry>;
  objectionHandling: Record<string, string>;
  skipReplyPatterns: string[];
  replyTiming: {
    conversationGapMinutes: number;
    firstReplyDelaySeconds: number;
    slowReplyDelaySeconds: number;
    normalReplyDelaySeconds: number;
    slowThresholdSeconds: number;
    randomExtraMaxSeconds: number;
  };
  confidence: {
    enabled: boolean;
    fallbackThreshold: number;
    fallbackPhrases: string[];
    clarifiers: Record<string, string[]>;
  };
  lowConfAlertThreshold: number;
  typingMsPerChar: number;
  typingMaxMs: number;
  groupReplyCooldownMs: number;
  maxResponseChars: number;
  maxResponseSentences: number;
  brainAnalysisInterval: number;
  brainAnalysisEnabled: boolean;
  aiFallbackPhrases: string[];
  returningContactDays: number;
}

export interface BotCommandEntry {
  id: string;
  name: string;
  description: string;
  instruction: string;
  generatedPrompt: string;
  enabled: boolean;
  createdAt: number;
  lastTestedAt: number | null;
  lastTestOutput: string | null;
}
