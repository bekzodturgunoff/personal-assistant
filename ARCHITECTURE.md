# Architecture — Personal Assistant Bot

## Data Flow

```
Telegram Business API  ──►  Cloudflare Worker
                                   │
                    ┌──────────────┴──────────────┐
                    │         fetch()              │
                    │    scheduled() (cron)        │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      worker.ts             src/handlers/         src/handlers/
      (entry point)         business.ts           telegram.ts
              │                    │                    │
              │         ┌──────────┴──────────┐         │
              │         ▼                     ▼         │
              │  classifyIntent()     evaluateConfidence()
              │  (pre-filter,         (post-AI check,
              │   no AI call)          before send)
              │         │                     │
              │         └──────────┬──────────┘
              │                    ▼
              │         businessAssistantReply()
              │         (prompts/business.ts)
              │                    │
              │         ┌──────────┴──────────┐
              │         ▼                     ▼
              │   callGeminiStructured()  callGeminiWithFallback()
              │   (lib/gemini.ts)         (lib/gemini.ts)
              │         │
              │         ▼
              │   callGroqWithFallback()
              │   (lib/groq.ts — brain only)
              │
              └────────────────────────────────┐
                                               ▼
                              ┌────────────────────────────────┐
                              │         Cloudflare KV           │
                              │                                │
                              │  CONVERSATIONS namespace:      │
                              │    chat:{id}                    │
                              │    persona:{id}                 │
                              │    timing:{id}                  │
                              │    muted:{id}                   │
                              │    cooldown:{model}             │
                              │    brain:summary:{id}           │
                              │    brain:output:{id}            │
                              │    _pending_replies             │
                              │                                │
                              │  TASKS namespace:               │
                              │    tasks:{user_id}              │
                              │                                │
                              │  LONG_TERM_MEMORY namespace:    │
                              │    memory:{id}                  │
                              │    owner_profile                │
                              │    pending:{id}                 │
                              │    lowconf:{id}                 │
                              │    stage:{id}                   │
                              │    first_contact:{id}           │
                              └────────────────────────────────┘
```

## Layer Overview

### 1. Entry Point (`worker.ts`)
- **fetch()** — handles Telegram webhooks, health checks, debug endpoints
- **scheduled()** — cron triggers at 3AM daily (morning briefing + due tasks) and 3AM Monday (weekly analytics)

### 2. Routing Layer (`handlers/telegram.ts` + `handlers/business.ts`)
- **telegram.ts** — DM messages via grammY, bot commands (`/mute`, `/unmute`, `/tasks`, `/remind`, `/done`, `/pending`)
- **business.ts** — Telegram Business messages (connection updates + incoming messages through Business API)

### 3. Intent Classifier (`lib/intent-classifier.ts`)
- **Pure function**, no side effects, no API calls
- Runs **before** any AI call as a pre-filter
- Classifies: urgency, greeting, price inquiry, complaint, detected language
- `estimatedUrgency` is derived from keyword matching + text heuristics

### 4. AI Reply Layer (`prompts/business.ts`)
- Builds the Gemini prompt from static identity + dynamic context (time, persona, history)
- Calls `callGeminiStructured()` which requests JSON with `{text, confidence, is_factual_claim}`
- Returns the raw `GeminiResponse` — no gating at this level

### 5. Gemini Client (`lib/gemini.ts`)
- 5-model fallback chain with 24h KV-backed cooldown
- `callGeminiStructured()` wraps `callGeminiWithFallback()` with a JSON response instruction
- Exports `GeminiResponse` interface used by the confidence scorer

### 6. Confidence Scorer (`lib/confidence-scorer.ts`)
- **Pure function**, no side effects
- Runs **after** the AI response, **before** sending the reply
- Evaluates Gemini's self-rated confidence + factual claim flag
- Returns `shouldFallback` boolean + fallback phrase if score < 0.65 AND is factual claim
- Fail-open: malformed JSON returns score=1.0, no fallback

### 7. Brain Analysis (`brain/`)
- Runs in background via `ctx.waitUntil()` after every reply
- Uses Groq (`llama-3.3-70b-versatile`) via `lib/groq.ts`
- Every 4th user message triggers analysis (summary, facts, intent, urgency, sentiment, relationship_stage)
- Full `BrainOutput` stored in CONVERSATIONS KV under `brain:output:{id}`

### 8. KV Store (`lib/kv-store.ts`)
- 3 KV namespaces: CONVERSATIONS, TASKS, LONG_TERM_MEMORY
- CONVERSATIONS: conversation history, persona profiles, timing state, mute, brain data, pending reply list
- TASKS: per-user task lists
- LONG_TERM_MEMORY: long-term facts, owner profile, pending questions, low-confidence counters, relationship stages, first contact dates
- Typed helper functions for LONG_TERM_MEMORY keys: `getPendingQuestions`, `getLowConfCount`, `incrementLowConfCount`, `resetLowConfCount`, `getRelationshipStage`, `setRelationshipStage`, `getFirstContactDate`, `setFirstContactDate`

### 9. Reply Timing (`lib/reply-timing.ts`)
- Mimics human reply behavior with configurable delays
- Normal: ~90s + random up to 2min
- First contact: ~4min + random
- Slow replier detected: ~4min + random
- Urgent messages (via intent classifier) bypass delay entirely

### 10. Cron Jobs

| Time | Handler | Purpose |
|---|---|---|
| Daily 3AM UTC | `handleMorningBriefing()` | Task list + pending questions |
| Daily 3AM UTC | `checkDueTasks()` | Overdue task alerts |
| Daily 3AM UTC | `processDuePendingReplies()` | Flush any pending replies |
| Monday 3AM UTC | `handleWeeklyAnalytics()` | Weekly conversation statistics |

## New Modules (this iteration)

| File | Purpose |
|---|---|
| `src/lib/intent-classifier.ts` | Pre-filter intent classification (no AI call) |
| `src/lib/confidence-scorer.ts` | Post-AI confidence evaluation + fallback selection |
| `src/lib/kv-store.ts` (extended) | Typed helpers for `pending:`, `lowconf:`, `stage:`, `first_contact:` prefixes in LONG_TERM_MEMORY |

## Key Decisions

- **Groq is brain-only** — Gemini handles all human-facing replies (better nuance)
- **No new KV namespaces** — all new data uses prefixed keys in existing LONG_TERM_MEMORY
- **Confidence scorer is fail-open** — if Gemini JSON is malformed, reply gets sent (don't crash the conversation)
- **Intent classifier is regex-only** — zero API cost, runs synchronously before any queued work
- **Low-conf counters persist in LONG_TERM_MEMORY** — survive Worker restarts, threshold=3 triggers owner handoff alert
- **No `any` types** — all new code uses strict TypeScript types
