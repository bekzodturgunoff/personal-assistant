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

export type JokeTopic = keyof typeof CHAT_JOKES;

function hashIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

export function pickJoke(topic: JokeTopic, seed: string): string {
  const jokes = CHAT_JOKES[topic] ?? CHAT_JOKES.default;
  return jokes[hashIndex(seed, jokes.length)];
}

export function detectTopic(text: string): JokeTopic {
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
