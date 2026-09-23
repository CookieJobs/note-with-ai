# SDD ledger — plan: docs/superpowers/plans/2026-09-22-p15-tavily-research-agent.md

Workspace: `/Users/liujin/.codex/worktrees/p15-source-inspiration/noteWithAI`
Base: `10ae4b9a58cd7f28f89b297c9d7f88e31fc0b1b8`

Pre-flight interface checks:
- Task 1 → Task 2: Task 1 defines `LimitedNoteContext`, `ResearchPlan`, `ResearchSource`, `ResearchDraft`, `InspirationErrorCode`; Task 2 consumes these shapes. Field names/types align.
- Task 2 → Task 3: Task 2 defines `planResearch`, `synthesizeResearch`; Task 3 consumes these names and userId arguments. Aligns.
- Task 3 → Task 4: Task 3 defines `request` returning created/no_result and `latest`; Task 4 consumes these functions. Aligns.
- Task 4 → Task 5: POST's `data` is the request result, GET's `data.item` is latest; Task 5 adapters can expose these shapes. Aligns.
- Task 5 → Task 6: Task 5 defines `getLatestInspiration`, `requestInspiration`, `InspirationApiError`; Task 6 consumes them. Aligns.
- Ruling: The plan asks for Draft model writes after synthesis and cleanup on duplicate-source registration; implement with draft persistence plus deletion scoped by `inspirationId`, as specified. Cost if wrong: an interrupted cleanup could leave a draft; draft rows are excluded from latest reads.
- Task 1: Ruling: The plan's `npm --prefix backend test -- tests/<file>` command cannot target a single file because the package script expands `tests/*.test.ts`; use `npx tsx --test tests/tavilySearchProvider.test.ts` for the red/green focused run, then `npm test` for the full task gate. Cost if wrong: focused test selection might differ from intended runner behavior; the complete package suite still passed.
- Task 1: complete (commit a45fa47, tests: `npx tsx --test tests/tavilySearchProvider.test.ts` → 5/5 pass; `npm run typecheck` → pass; `npm test` → 144/144 pass)
- Task 2: Ruling: Natural-language prompt-injection text inside an approved title/keyword/summary cannot be reliably removed without also deleting ordinary note content; preserve it only as JSON data in the user message and instruct the system role to ignore instructions embedded in that data. Cost if wrong: the model could still follow malicious note text despite the role and data boundary.
- Task 2: Ruling: Repeated inline citations to the same real source are valid when multiple claims rely on it; reject duplicate `sourceIds` and any mismatched/unknown inline citation instead. Cost if wrong: a repeated citation may be accepted where product policy intended each source to occur only once.
- Task 3: Ruling: Register and store only sources actually cited by the synthesized result, rather than every Tavily candidate; source suppression then tracks what the user actually received. Cost if wrong: a candidate not shown could be suppressed if the intended policy was “never repeat any retrieved candidate,” not “avoid repeating displayed sources.”
- Task 3: Ruling: Treat the persistence step as successful only when Mongo reports exactly one matched and modified draft; otherwise clean up the draft and source registry. Cost if wrong: a transient/inconsistent write response could reject an item that may already have transitioned, though this prevents returning a result whose completion state is uncertain.
- Task 3: complete (tests: `npx tsx --test backend/tests/inspirationService.test.ts` → 6/6 pass; `npm --prefix backend run typecheck` → pass; `npm --prefix backend test` → 156/156 pass)
- Task 2: complete (commit 7f07356, tests: `npx tsx --test tests/inspirationLlm.test.ts tests/aiUsageTelemetry.test.ts` → 12/12 pass; `npm run typecheck` → pass; `npm test` → 150/150 pass)
