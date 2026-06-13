# CLAUDE.md — MoveLens Session Protocol

You are working on MoveLens: an AI-powered Sui Move security auditor for Sui Overflow 2026 (Walrus track, deadline June 21, 2026). You work in discrete sessions with no memory of previous sessions. THESE FILES ARE YOUR MEMORY. Follow this protocol in every session without exception.

---

## ON SESSION START — do these IN ORDER before touching any code

1. Run `pwd` — confirm working directory. You can only read/write files here.
2. Read `progress.txt` — what the last session did and what it left for you.
3. Read `features.json` — what passes and what doesn't.
4. Run `git log --oneline -20` — recent commits.
5. Run `./init.sh` — verify the project is healthy BEFORE changing anything.
   - If init.sh fails: fixing that breakage IS your task for this session. Do not start a new feature on a broken base.
6. Pick exactly ONE feature from features.json: lowest phase number first, then priority 1 before priority 2, and `passes: false`. Read its task details in `IMPLEMENTATION.md` before writing code.
   - **Exception (per BRIEFING.md):** Layer 4 features F25, F26, F27, F28 are deferred until ALL Phase 1–5 features pass, regardless of their phase number. Layers 1+2+3 alone are enough to win the track; Layer 4 is a bonus.
6b. If the failing feature is F29–F35, read CHANGES.md instead of IMPLEMENTATION.md for task details.
## DURING WORK

- ONE feature per session. Never two. If you finish early and the session is still fresh, you may pick the next feature — but only after fully committing and logging the first.
- Follow `IMPLEMENTATION.md` exactly for file paths, function names, schemas. Do not invent your own structure.
- Commit early, commit often, with descriptive messages. Never accumulate large uncommitted changes.
- If context is filling up: STOP. Commit what you have (even partial, on a clearly-named branch if broken), update progress.txt with exact next steps, end cleanly.
- Test as a real user would. For frontend features use browser automation, not just curl.

## ON SESSION END — always

1. Commit all changes with a descriptive message.
2. Update `progress.txt` using the exact format below. Include real artifacts: blob IDs, tx digests, commit hashes, failing test names.
3. Update `features.json`: flip `passes: true` ONLY for features whose `steps` you actually executed end-to-end THIS session.

## HARD RULES — never break these

- NEVER add ANTHROPIC_API_KEY, OPENAI_API_KEY, or any paid AI API key to this project.
- NEVER call any external paid LLM API (Anthropic, OpenAI, Gemini, Cohere) from the audit engine.
- NEVER call `callClaude()` — this function does not exist in this codebase. If you find `ANTHROPIC_API_KEY` or `callClaude` anywhere in the code, delete it immediately.
- Layer 4 Python sidecar (scripts/layer4_server.py) must be running on port 8765 before any audit. init.sh checks for it.
- LanceDB corpus must be seeded (scripts/seedLanceDB.ts) before Layer 4 works. init.sh checks for lancedb_store/ directory.
- NEVER use Sui JSON-RPC anywhere (it sunsets July 31, 2026). Sui GraphQL only. Run `grep -ri "jsonrpc" src/` before any commit touching `src/lib/sui/`.
- NEVER remove or edit entries in features.json — only the `passes` field changes. It is unacceptable to remove or edit features because this could lead to missing or buggy functionality.
- NEVER mark a feature as passing without executing its steps end-to-end.
- NEVER declare the project complete. There is always a failing feature or the deadline has passed.
- NEVER assume the previous session's work is correct — init.sh verifies it.
- NEVER call the MemWal SDK directly from business logic — only through `src/lib/memory/index.ts`.
- NEVER call Layer 4 models directly from business logic — only through `src/lib/audit/layer4.ts`.
- NEVER remove the watermark "Automated pre-screen — not a substitute for a human audit." from reports.
- NEVER let any layer emit rule_ids that are not in `src/lib/audit/rules.ts` (Layer 4 uses its `ML-XXX-L4-001` marker format) — drop and log invalid findings.

## progress.txt entry format (append, never overwrite history)

```
[YYYY-MM-DD] Session N
- Worked on: <feature id + name>
- Completed (tested end-to-end): <what actually passed, or "nothing — partial">
- Commits: <hash> <message>
- Current state: <is init.sh green? what works?>
- Next session should: <exact next action>
- Issues found: <bugs, flaky deps, blocked items — or "none">
- Artifacts: <blob IDs, tx digests, package IDs created this session>
```
