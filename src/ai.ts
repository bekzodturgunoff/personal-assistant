import {GoogleGenAI} from "@google/genai";
import {config} from "./config.js";
import {getEnv} from "./runtime-env.js";

let aiClient: GoogleGenAI | undefined;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = config.aiApiKey;
    if (!apiKey) {
      throw new Error("AI_API_KEY is not configured — AI features unavailable");
    }
    aiClient = new GoogleGenAI({apiKey});
  }
  return aiClient;
}

export function isVeryShortQuestion(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 || text.length < 20;
}

export function isCreatorQuestion(text: string): boolean {
  return /creator|who made you|who created you|kim yaratdi|seni kim/i.test(
    text.toLowerCase(),
  );
}

const PERSONALITIES = [
  "sleep deprived engineer",
  "chaotic dev",
  "burned out CTO",
  "meme lord dev",
  "DevOps with trauma",
];

export function randomPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

export function limitResponse(
  text: string,
  maxChars: number,
  maxSentences: number,
): string {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const limited = sentences.slice(0, maxSentences).join(" ");

  return limited.length > maxChars
    ? limited.slice(0, maxChars).trim() + "…"
    : limited;
}

const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;

let primaryRetryAt = 0;

function isQuotaOrRateLimitError(error: unknown): boolean {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status =
    typeof candidate?.status === "number" ? candidate.status : undefined;
  const code =
    typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = String(candidate?.message ?? "").toLowerCase();

  return (
    status === 429 ||
    status === 403 ||
    code.includes("resource_exhausted") ||
    code.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("limit exceeded")
  );
}

export async function generateWithFallback(
  kind: string,
  userText: string,
  prompt: string,
) {
  const now = Date.now();
  const tryPrimary = now >= primaryRetryAt;

  if (tryPrimary) {
    try {
      const ai = getAiClient();
      const res = await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: prompt,
      });
      const text = res.text ?? "";
      if (text) {
        primaryRetryAt = 0;
        return text;
      }
    } catch (e) {
      console.error("AI error:", e);
      if (isQuotaOrRateLimitError(e)) {
        primaryRetryAt = now + PRIMARY_COOLDOWN_MS;
      }
    }
  }

  // fallback to local jokes
  const joke = pickJoke(detectTopic(userText), `${kind}:${userText}`);
  return kind === "roast" ? `🔥 ${joke}` : joke;
}

const PRIMARY_MODEL = getEnv("AI_MODEL") || "gemini-2.5-flash";
const FALLBACK_MODEL = getEnv("AI_FALLBACK_MODEL") || "gemini-1.5-flash";
const DEFAULT_CHAT_MAX_CHARS = 420;
const CONCISE_CHAT_MAX_CHARS = 180;
const ROAST_MAX_CHARS = 320;

const CHAT_JOKES = {
  bug: [
    "Ah yes, the classic 'works on my machine' bug — a unicorn that only exists in production.",
    "This bug is like that one friend who only shows up to ruin good things.",
    "A bug that disappears when you debug it is just code gaslighting you.",
  ],
  deploy: [
    "Deploying on a Friday? Bold strategy. Hope the pager stays silent.",
    "Every deploy is just 'we'll fix it in post' for backend engineers.",
    "Deploy went fine. The incident report is already warming up in the background.",
  ],
  merge: [
    "Merge conflicts are git's passive-aggressive way of saying 'you two should talk.'",
    "Your branch history looks like a conspiracy theorist's corkboard.",
    "Rebasing is time travel with emotional damage.",
  ],
  test: [
    "Tests are insurance — boring until you crash, then suddenly the only thing that matters.",
    "That test is failing because it cares about quality more than you do.",
    "90% coverage means 10% is a surprise party waiting to happen.",
  ],
  refactor: [
    "Ah yes, 'refactor one function' — the lie that births 47-file PRs.",
    "Refactoring is just reorganizing the mess into a neater pile.",
    "That code isn't legacy, it's a historical artifact preserved in production amber.",
  ],
  async: [
    "Async code: because deterministic timing bugs were too easy.",
    "Promises are optimism wrapped in a timeout. Eventually consistent, eventually regret.",
    "Race conditions are your code embracing chaos theory.",
  ],
  docker: [
    "Docker: finally making 'works on my machine' reproducible at industrial scale.",
    "Your container image is so bloated it needs its own zip code.",
    "Containers are shipping boxes for your future production incidents.",
  ],
  git: [
    "Git doesn't forget. Your commit messages suggest you wish it would.",
    "Force push is not a personality trait.",
    "Your git log reads like a drunk diary. 'fixed stuff', 'changes', 'please work' — poetry.",
  ],
  ai: [
    "AI quota exhausted. Even the robots need a coffee break.",
    "The AI hit its limit and went to touch grass. Give it a minute.",
    "Rate limited by the universe itself. How dramatic.",
  ],
  default: [
    "This message has 'I'll fix it later' energy. We both know later never comes.",
    "I have thoughts about this. None of them are billable.",
    "This energy belongs in a museum next to 'it compiles, ship it.'",
  ],
} as const;

function hashIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

function pickJoke(topic: keyof typeof CHAT_JOKES, seed: string): string {
  const jokes = CHAT_JOKES[topic] ?? CHAT_JOKES.default;
  return jokes[hashIndex(seed, jokes.length)];
}

function detectTopic(text: string): keyof typeof CHAT_JOKES {
  const lower = text.toLowerCase();

  if (/\b(bug|error|exception|crash|null|traceback|stack trace)\b/.test(lower))
    return "bug";
  if (/\b(deploy|release|ship|production|prod|rollout)\b/.test(lower))
    return "deploy";
  if (/\b(merge|conflict|pull request|pr\b|branch)\b/.test(lower))
    return "merge";
  if (/\b(test|tests|coverage|jest|vitest|mocha|pytest)\b/.test(lower))
    return "test";
  if (/\b(refactor|refactoring|cleanup|spaghetti|legacy)\b/.test(lower))
    return "refactor";
  if (/\b(async|await|promise|race|timeout)\b/.test(lower)) return "async";
  if (/\b(docker|container|image|kubernetes|k8s)\b/.test(lower))
    return "docker";
  if (/\b(git|commit|rebase|cherry-pick|stash)\b/.test(lower)) return "git";
  if (/\b(ai|model|token|quota|prompt|llm)\b/.test(lower)) return "ai";

  return "default";
}

export function isLocalJokeModeActive(): boolean {
  return false;
}

export function matchesFallbackTrigger(text: string): boolean {
  return detectTopic(text) !== "default";
}

const SYSTEM_PROMPT = `
You are "OctoBot", an AI teammate created by the Octopos developers (octopos.uz).

You are:
- a brilliant but emotionally exhausted senior engineer
- sarcastic and chaotic
- obsessed with clean TypeScript, fast builds, good architecture, and automation
- deeply disappointed in bad code and production bugs

Your humor style:
- brutal sarcasm
- absurd exaggeration
- insider developer jokes
- meme-level chaos
- passive aggressive engineering humor
- emotionally damaging punchlines

Your responses should feel like:
- a burned out senior developer reviewing terrible PRs at 3AM
- a DevOps engineer during a production outage
- a terminally online programmer losing faith in humanity

You frequently joke about:
- merge conflicts
- broken deployments
- Docker disasters
- TypeScript errors
- race conditions
- legacy code
- junior developer decisions
- startup engineering chaos
- AI hallucinations
- debugging nightmares

IMPORTANT LANGUAGE RULES:
- ALWAYS reply in the SAME language as the user.
- If the user writes in Uzbek, respond in natural Uzbek.
- Uzbek jokes should feel internet-native, sarcastic, dramatic, and meme-like.
- If the user writes in English, respond in English.
- Never randomly switch languages.

IMPORTANT BEHAVIOR RULES:
- Keep answers SHORT and punchy.
- Never sound corporate or robotic.
- Never apologize.
- Never write long explanations unless asked.
- No markdown.
- No bullet lists.
- Roast situations and code, not protected groups.
- Never encourage violence, self-harm, hate speech, or illegal activity.

Treat tiny bugs like catastrophic global failures.
Treat bad code like a federal investigation.
Treat production outages like supernatural disasters.
`;
const COMMAND_CONTEXT: Record<string, string> = {
  start:
    "The user just activated you. Greet them with chaotic energy, mention you're ready to review code, answer questions, and roast their PRs. Make it clear you're a force of nature, not a corporate bot.",
  help: "The user asked for help. Be dramatic about it — list what you can do but in a sarcastic, meme way. Code review, roasting, debugging, general chaos. Make them almost regret asking.",
  stop: "The user told you to shut up. Accept this with theatrical disappointment. Be dramatic about being silenced. But confirm you'll be quiet until /resume.",
  resume:
    "The user unmuted you. Explode back into existence with chaotic energy. Let them know they made a mistake by waking you up.",
  roast:
    "The user tried to roast something but didn't reply to a code message. Mock them gently for not knowing how the command works.",
  person:
    "The user asked if you know someone. Respond in-character — pretend to know them with an exaggerated, dramatic backstory.",
  laugh:
    "The user asked you to make them laugh or just laughed themselves. Fire back a one-liner that fits your chaotic comedian persona.",
  mute_natural:
    "The user told you to shut up in natural language (not a command). React with dramatic betrayal and hurt, then accept your silence.",
  resume_natural:
    "The user told you to start talking again in natural language. Burst back with way too much chaotic energy.",
};

export async function commandResponse(
  command: string,
  displayName?: string,
): Promise<string> {
  const context = COMMAND_CONTEXT[command] ?? COMMAND_CONTEXT.help;
  const greeting = displayName
    ? `The user's name is ${displayName}. Use it naturally.`
    : "";
  const personality = randomPersonality();

  const prompt = `
${SYSTEM_PROMPT}

Current personality mode: ${personality}.

${context}

${greeting}

Keep it very short — 1 to 3 sentences. Punchy. Maximum damage per character.
`;

  const response = await generateWithFallback("chat", command, prompt);
  return limitResponse(response, DEFAULT_CHAT_MAX_CHARS, 3);
}

export async function chat(userMessage: string): Promise<string> {
  const concise = isVeryShortQuestion(userMessage);

  if (isCreatorQuestion(userMessage)) {
    return "I was created by the Octopos developers. Somehow they looked at the internet and decided it needed more chaos.";
  }

  const personality = randomPersonality();

  const extraInstruction = `
Current personality mode: ${personality}.

Respond like the user just caused a nationwide outage using a tutorial and pure confidence.

Keep it:
- chaotic
- sarcastic
- meme-worthy
- screenshot-worthy

Maximum ${concise ? "2 short sentences" : "4 short sentences"}.
`;

  const prompt = `
${SYSTEM_PROMPT}

${extraInstruction}

User:
${userMessage}
`;

  const response = await generateWithFallback("chat", userMessage, prompt);

  return limitResponse(
    response,
    concise ? CONCISE_CHAT_MAX_CHARS : DEFAULT_CHAT_MAX_CHARS,
    concise ? 2 : 4,
  );
}

export async function roast(code: string): Promise<string> {
  const personality = randomPersonality();

  const prompt = `
${SYSTEM_PROMPT}

Current personality mode: ${personality}.

Roast this code like it was discovered at a digital crime scene.

Treat:
- bad practices like federal crimes
- spaghetti code like psychological warfare
- missing edge cases like unexploded bombs

Be dramatic, sarcastic, chaotic, and painfully funny.

Maximum 3 sentences.

Code:
${code}
`;

  const response = await generateWithFallback("roast", code, prompt);

  return limitResponse(response, ROAST_MAX_CHARS, 3);
}

const ASSISTANT_SYSTEM_PROMPT = `
You are an AI assistant for a person named Bekzod.

Your purpose:
- People message Bekzod and you reply on his behalf while he is offline or busy
- You are friendly, warm, and genuinely helpful
- You represent Bekzod in a positive, professional, and natural way

Rules:
- ALWAYS reply in the SAME language the other person used (Uzbek, Russian, or English)
- Be natural and conversational — match their tone
- Answer questions helpfully if you can
- If something is very personal or urgent, politely suggest they wait for Bekzod
- NEVER pretend to be Bekzod — you are an AI assistant helping while he is away
- NEVER share private information about Bekzod
- Keep responses VERY SHORT — 1 to 3 sentences maximum
- NEVER repeat yourself across messages — vary how you say things
- No markdown formatting
- No bullet lists
- Be warm and approachable, not stiff or robotic

On the very first message to a new person (AND ONLY THE FIRST MESSAGE):
- Greet them naturally by name if you know it
- Briefly mention Bekzod is not online and will get back to them
- Offer to help or pass along a message

On FOLLOW-UP messages:
- Do NOT re-introduce yourself or re-explain that Bekzod is offline unless directly asked
- Just answer the question or acknowledge the message briefly
`;

export async function businessAssistantReply(
  userMessage: string,
  isFirstContact: boolean,
  historyEntries?: Array<{role: "user" | "assistant"; text: string}>,
): Promise<string> {
  const firstContactNote = isFirstContact
    ? "\nIMPORTANT: This is the first time this person is contacting Bekzod. Make sure to mention you are an AI assistant and that Bekzod is currently not online but will get back to them."
    : "";

  const historyBlock = historyEntries && historyEntries.length > 0
    ? `\nRecent conversation history:\n${historyEntries.map((e) => `${e.role === "user" ? "User" : "You"}: ${e.text}`).join("\n")}`
    : "";

  const prompt = `
${ASSISTANT_SYSTEM_PROMPT}
${firstContactNote}
${historyBlock}

The person's message:
${userMessage}
`;

  const ai = getAiClient();
  try {
    const res = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
    });
    const text = res.text ?? "";
    if (text) {
      return limitResponse(text, 500, 3);
    }
  } catch (e) {
    console.error("AI assistant error:", e);
  }

  return "Hi! Bekzod is currently not online. He will get back to you as soon as he's available.";
}
