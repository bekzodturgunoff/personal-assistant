import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.aiApiKey });

const PRIMARY_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gemini-1.5-flash';
const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_MODE_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_NOTICE_REPEAT_MS = 5 * 60 * 1000;

let primaryRetryAt = 0;
let localModeRetryAt = 0;
let lastLocalNoticeAt = 0;

const CHAT_JOKES = {
  bug: [
    'That bug has strong main-character energy. It only appears when the debugger is closed.',
    'Classic bug behavior: invisible in dev, legendary in production.',
    'The bug is not lost. It is simply exploring the codebase unsupervised.',
  ],
  deploy: [
    'Deployments are just production’s way of asking, "Are you sure?"',
    'Every deploy is a small leap of faith with a large invoice attached.',
    'The deploy went out. The incident report is already warming up.',
  ],
  merge: [
    'Merge conflicts are just git’s way of scheduling team bonding.',
    'Nothing says collaboration like two branches arguing in public.',
    'Git saw your branches and chose violence.',
  ],
  test: [
    'Tests are like seatbelts. Everyone appreciates them after the crash.',
    'A failing test is just the code being honest before the release does it for you.',
    'Coverage is not a badge. It is a warning label without enough ink.',
  ],
  refactor: [
    'Refactoring is the art of making the same mess look professionally arranged.',
    'Spaghetti code becomes lasagna if you layer enough refactors.',
    'Refactors are how we apologize to future-us without sending flowers.',
  ],
  async: [
    'Async code: where timing bugs go to become folklore.',
    'Promises are just optimism with a timeout.',
    'Race conditions are what happens when the code chooses chaos as a lifestyle.',
  ],
  docker: [
    'Docker: because "works on my machine" was not ambitious enough.',
    'Containers are just shipping boxes for your future incident.',
    'If the image is huge, at least it has personality.',
  ],
  git: [
    'Git never forgets. Your branch names wish it did.',
    'Rebasing is just time travel with emotional damage.',
    'Commit messages are the diary entries we pretend are documentation.',
  ],
  ai: [
    'AI limits are the universe politely asking you to slow down.',
    'Even the machine needs coffee breaks, apparently.',
    'The model hit its quota and walked off to touch grass.',
  ],
  default: [
    'That message has enough technical debt to qualify for its own parking spot.',
    'This one has strong "it passed CI by accident" energy.',
    'I have opinions about this text, and none of them are billable.',
  ],
} as const;

type ResponseKind = 'chat' | 'roast';

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
  const digest = crypto.createHash('sha256').update(seed).digest();
  return digest[0] % length;
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

export function matchesFallbackTrigger(text: string): boolean {
  return detectTopic(text) !== 'default';
}

function buildLocalResponse(kind: ResponseKind, text: string, includeLimitNotice: boolean): string {
  const topic = detectTopic(text);
  const joke = pickJoke(topic, `${kind}:${text}`);

  const intro = kind === 'roast'
    ? 'I am out of AI quota, so the local roast cannon is online.'
    : 'AI quota is temporarily exhausted, so OctoBot switched to local joke mode.';

  if (!includeLimitNotice) {
    return kind === 'roast'
      ? `🔥 ${joke}`
      : joke;
  }

  return `${intro}\n\n${joke}`;
}

async function generateContent(model: string, contents: string): Promise<string> {
  const response = await ai.models.generateContent({
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

const SYSTEM_PROMPT = "You are 'OctoBot', a brilliant, sharp-witted, and slightly sarcastic AI teammate for the Octopos core engineering team. You love clean code, robust TypeScript, fast builds, and automated testing. You frequently make lighthearted, insider tech jokes about edge cases, bugs, refactoring, merge conflicts, and developer habits. Keep answers casual, highly tech-savvy, and engaging. Never sound like a generic corporate assistant.";

export async function chat(userMessage: string): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\nUser: ${userMessage}`;
  return generateWithFallback('chat', userMessage, prompt);
}

export async function roast(code: string): Promise<string> {
  const prompt = `You are 'OctoBot', a brilliant, sharp-witted, and slightly sarcastic AI teammate. Roast the following code. Be funny, constructive, and slightly brutal. Point out bad practices, unnecessary complexity, and things that made you cringe. Keep it entertaining but useful.\n\nCode:\n\`\`\`\n${code}\n\`\`\``;
  return generateWithFallback('roast', code, prompt);
}
