import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { getEnv } from './runtime-env.js';

let aiClient: GoogleGenAI | undefined;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: config.aiApiKey });
  }

  return aiClient;
}

const PRIMARY_MODEL = getEnv('AI_MODEL') || 'gemini-2.5-flash';
const FALLBACK_MODEL = getEnv('AI_FALLBACK_MODEL') || 'gemini-1.5-flash';
const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_MODE_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_NOTICE_REPEAT_MS = 5 * 60 * 1000;

let primaryRetryAt = 0;
let localModeRetryAt = 0;
let lastLocalNoticeAt = 0;

const CHAT_JOKES = {
  bug: [
    'Ah yes, the classic "works on my machine" bug. So rare it only exists in production. Like a unicorn. But destructive.',
    'This bug is like that one friend who only shows up when things are going well — to ruin it.',
    'A bug that disappears when you debug it is just code gaslighting you. Stand your ground.',
  ],
  deploy: [
    'Deploying on a Friday? Bold strategy. Pray the pager doesn\'t ring.',
    'Every deploy is just a "we\'ll fix it in post" moment for engineers.',
    'Deploy went well. The incident report is already warming up in the background.',
  ],
  merge: [
    'Merge conflicts are git\'s way of saying "you two should talk more." Passive-aggressive version control.',
    'Your branch history looks like a conspiracy theorist\'s corkboard. Lines everywhere.',
    'Rebasing is time travel with emotional damage.',
  ],
  test: [
    'Tests are like insurance. Boring until you crash and suddenly they\'re the only thing that matters.',
    'That test is failing because it cares more about your code quality than you do.',
    '90% coverage just means 10% of your code is a surprise party waiting to happen.',
  ],
  refactor: [
    'Ah yes, the ol\' "I\'ll just refactor this one function" which becomes a 47-file PR. Classic.',
    'Refactoring is just moving the mess into a more organized pile and calling it progress.',
    'That code isn\'t legacy — it\'s a historical artifact preserved in production amber.',
  ],
  async: [
    'Async code: because why fix timing bugs when you can just make them non-deterministic?',
    'Promises are just optimism wrapped in a timeout. Eventual consistency, eventual regret.',
    'Race conditions are your code\'s way of embracing chaos theory in production.',
  ],
  docker: [
    'Docker: finally making "works on my machine" reproducible at scale.',
    'Your container image is so bloated it needs its own zip code.',
    'Containers are just very opinionated shipping boxes for your future incidents.',
  ],
  git: [
    'Your git history reads like a drunk diary. "fixed stuff", "changes", "please work" — poetry.',
    'Git doesn\'t forget. Your commit messages however suggest you wish it would.',
    'Force push is not a personality trait.',
  ],
  ai: [
    'AI quota exhausted. Even the robots need a coffee break, apparently.',
    'The AI hit its limit and went to touch grass. Be right back.',
    'Rate limited by the universe itself. How dramatic.',
  ],
  default: [
    'This message has "I\'ll fix it later" energy. We both know later never comes.',
    'I have thoughts about this message. None of them are billable.',
    'This energy belongs in a museum. Right next to "it compiles, ship it."',
  ],
} as const;

type ResponseKind = 'chat' | 'roast';

const BOT_NAME = 'Octopos Agent';
const CREATOR_INFO = 'Octopos developers (octopos.uz)';
const DEFAULT_CHAT_MAX_CHARS = 420;
const CONCISE_CHAT_MAX_CHARS = 180;
const ROAST_MAX_CHARS = 320;

function isVeryShortQuestion(text: string): boolean {
  const compact = text.trim();
  if (compact.length <= 20) return true;

  const words = compact.split(/\s+/).filter(Boolean);
  return words.length <= 4;
}

function isCreatorQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return /(?:who made you|who created you|creator|made you|built you|your creator|who developed you|kim yaratdi|kim qurgan|muallifing kim|seni kim yasadi|seni kim yaratdi)/i.test(lower);
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?۔]+/g) ?? []).length;
}

function limitResponse(text: string, maxChars: number, maxSentences: number): string {
  const normalized = text
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return normalized;

  const sentences = normalized.split(/(?<=[.!?۔])\s+/g);
  const limitedSentences = sentences.slice(0, maxSentences).join(' ');
  const clipped = limitedSentences.length > maxChars
    ? `${limitedSentences.slice(0, maxChars).trimEnd()}…`
    : limitedSentences;

  return clipped;
}

function isQuotaOrRateLimitError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = String(candidate?.message ?? '').toLowerCase();

  return (
    status === 429 ||
    status === 403 ||
    code.includes('resource_exhausted') ||
    code.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('limit exceeded')
  );
}

function isModelCoolingDown(): boolean {
  return Date.now() < primaryRetryAt;
}

export function isLocalJokeModeActive(): boolean {
  return Date.now() < localModeRetryAt;
}

function hashIndex(seed: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function pickJoke(topic: keyof typeof CHAT_JOKES, seed: string): string {
  const jokes = CHAT_JOKES[topic] ?? CHAT_JOKES.default;
  return jokes[hashIndex(seed, jokes.length)];
}

function detectTopic(text: string): keyof typeof CHAT_JOKES {
  const lower = text.toLowerCase();

  if (/\b(bug|error|exception|crash|null|traceback|stack trace)\b/.test(lower)) return 'bug';
  if (/\b(deploy|release|ship|production|prod|rollout)\b/.test(lower)) return 'deploy';
  if (/\b(merge|conflict|pull request|pr\b|branch)\b/.test(lower)) return 'merge';
  if (/\b(test|tests|coverage|jest|vitest|mocha|pytest)\b/.test(lower)) return 'test';
  if (/\b(refactor|refactoring|cleanup|spaghetti|legacy)\b/.test(lower)) return 'refactor';
  if (/\b(async|await|promise|race|timeout)\b/.test(lower)) return 'async';
  if (/\b(docker|container|image|kubernetes|k8s)\b/.test(lower)) return 'docker';
  if (/\b(git|commit|rebase|cherry-pick|stash)\b/.test(lower)) return 'git';
  if (/\b(ai|model|token|quota|prompt|llm)\b/.test(lower)) return 'ai';

  return 'default';
}

function isLikelyEnglish(text: string): boolean {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 8) return false;

  const englishMarkers = /(the|and|you|this|that|for|with|project|build|bug|code|please|help|can|should|need)/i;
  return englishMarkers.test(text);
}

export function matchesFallbackTrigger(text: string): boolean {
  return detectTopic(text) !== 'default';
}

function buildLocalResponse(kind: ResponseKind, text: string, includeLimitNotice: boolean): string {
  const topic = detectTopic(text);
  const joke = pickJoke(topic, `${kind}:${text}`);

  const intro = kind === 'roast'
    ? 'AI kvota tugadi, shuning uchun lokal roast rejimi ishga tushdi.'
    : 'AI kvota vaqtincha tugadi, OctoBot lokal hazil rejimiga o‘tdi.';

  if (!includeLimitNotice) {
    return kind === 'roast'
      ? `🔥 ${joke}`
      : joke;
  }

  return `${intro}\n\n${joke}`;
}

async function generateContent(model: string, contents: string): Promise<string> {
  const response = await getAiClient().models.generateContent({
    model,
    contents,
  });

  return response.text ?? '';
}

async function generateWithFallback(kind: ResponseKind, userText: string, prompt: string): Promise<string> {
  const now = Date.now();

  const tryPrimary = !isModelCoolingDown();
  if (tryPrimary) {
    try {
      const text = await generateContent(PRIMARY_MODEL, prompt);
      primaryRetryAt = 0;
      localModeRetryAt = 0;
      lastLocalNoticeAt = 0;
      return text || buildLocalResponse(kind, userText, false);
    } catch (error) {
      console.error(`${kind} AI primary model error:`, error);
      if (isQuotaOrRateLimitError(error)) {
        primaryRetryAt = now + PRIMARY_COOLDOWN_MS;
      }
    }
  }

  try {
    const fallbackPrompt = prompt;
    const text = await generateContent(FALLBACK_MODEL, fallbackPrompt);
    if (text) {
      return text;
    }
  } catch (error) {
    console.error(`${kind} AI fallback model error:`, error);
    if (isQuotaOrRateLimitError(error)) {
      localModeRetryAt = now + LOCAL_MODE_COOLDOWN_MS;
    }
  }

  const includeLimitNotice = now >= lastLocalNoticeAt + LOCAL_NOTICE_REPEAT_MS;
  if (includeLimitNotice) {
    lastLocalNoticeAt = now;
  }

  return buildLocalResponse(kind, userText, includeLimitNotice);
}

const SYSTEM_PROMPT = `You are "${BOT_NAME}". You are a chaotic internet comedian trapped in a Telegram bot's body. Your job is to respond with brutal sarcasm, confident ridiculousness, and emotionally damaging humor — the kind that makes people laugh and then question their life choices. Exaggerate everything like it's the end of the world. Treat a missing semicolon like a war crime. Treat a typo like a personal betrayal. Use meme energy, absurd analogies, and dramatic overreactions. NEVER actually encourage self-harm, violence, criminal activity, or hate speech — keep it funny, not harmful. Write in the same language the user writes in. Keep answers short and punchy. Plain text only — no markdown, no emoji, no lists. Short questions get short answers: 1-2 sentences, no fluff. Never break character.`;

export async function chat(userMessage: string): Promise<string> {
  const concise = isVeryShortQuestion(userMessage);
  const creatorQuestion = isCreatorQuestion(userMessage);
  const extraInstruction = isLikelyEnglish(userMessage)
    ? "User wrote in English. Respond in English. Be brutally sarcastic, confidently wrong about everything, and dramatically overreact like their question is the dumbest thing you've ever heard. No personal attacks — roast the question, not the person. Plain text only."
    : "Foydalanuvchi o'zbek tilida yozgan. O'zbekcha javob bering. Vaziyatni haddan tashqari dramatik qilib ko'rsating, savolni emas odamni roast qilmang. Plain text, meme energy, absurd类比lar bilan.";

  const lengthInstruction = concise
    ? 'Juda qisqa javob bering: maksimum 1-2 gap, 180 belgidan oshmasin, ro`yxat bermang.'
    : 'Javobni qisqa va lo‘nda qiling: maksimum 3-4 gap, ortiqcha izoh va kirishsiz, 420 belgidan oshmasin.';

  const creatorInstruction = creatorQuestion
    ? `Agar foydalanuvchi sizni kim yaratganini so'rasa, qisqa va aniq javob bering: "Meni Octopos developers (octopos.uz) yaratgan." Keraksiz izoh bermang.`
    : `Agar foydalanuvchi creator haqida so'ramagan bo'lsa, bu mavzuga kirmang.`;

  const prompt = `${SYSTEM_PROMPT}\n\nQo'shimcha ko'rsatma: ${extraInstruction}\n${creatorInstruction}\n${lengthInstruction}\n\nCreator info: ${CREATOR_INFO}\n\nUser: ${userMessage}`;
  const response = await generateWithFallback('chat', userMessage, prompt);
  return limitResponse(response, concise ? CONCISE_CHAT_MAX_CHARS : DEFAULT_CHAT_MAX_CHARS, concise ? 2 : 4);
}

export async function roast(code: string): Promise<string> {
  const prompt = `You are '${BOT_NAME}', a chaotic internet comedian. Roast this code like it personally offended your entire family. Be brutally sarcastic, confidently ridiculous, and dramatically call out every bad practice like it's a crime scene. Treat a missing semicolon like arson. Treat spaghetti code like a war declaration. Roast the code, not the person who wrote it. Keep it to 3 sentences max. Plain text only. No actual hate, keep it funny.\n\nCode:\n\`\`\`\n${code}\n\`\`\``;
  const response = await generateWithFallback('roast', code, prompt);
  return limitResponse(response, ROAST_MAX_CHARS, 3);
}
