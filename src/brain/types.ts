export interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
  timestamp?: number;
}

export interface BrainAnalysis {
  summary: string;
  newFacts: string[];
  intent: "price_inquiry" | "complaint" | "greeting" | "request" | "follow_up" | "other";
  urgency: "low" | "medium" | "high";
  pending_questions: string[];
  sentiment: "positive" | "neutral" | "negative";
  relationship_stage: "stranger" | "acquaintance" | "warm_lead" | "regular";
}

export const BRAIN_OUTPUT_DEFAULTS: BrainAnalysis = {
  summary: "",
  newFacts: [],
  intent: "other",
  urgency: "low",
  pending_questions: [],
  sentiment: "neutral",
  relationship_stage: "stranger",
};

export interface BrainProvider {
  analyze(
    history: ConversationEntry[],
    currentSummary: string,
    existingFacts: string[],
    senderName?: string,
  ): Promise<BrainAnalysis>;
}

export interface BrainOutput {
  summary: string;
  facts: string[];
  intent: "price_inquiry" | "complaint" | "greeting" | "request" | "follow_up" | "other";
  urgency: "low" | "medium" | "high";
  pending_questions: string[];
  sentiment: "positive" | "neutral" | "negative";
  relationship_stage: "stranger" | "acquaintance" | "warm_lead" | "regular";
  is_returning: boolean;
  lastUpdated: number;
}
