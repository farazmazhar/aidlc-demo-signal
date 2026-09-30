# Unit Test Instructions — Build Signal

Stage target: `AIDLC-STAGE: code-generation` (zero-Unit, scope `poc`, depth Minimal, test strategy Minimal). These instructions cover the unit tests written by this stage and are the commands Build and Test executes for this target.

## Framework and configuration

| Item | Value |
|---|---|
| Runner | `bun test` — the built-in Jest-compatible runner of the Bun toolchain already present in this environment |
| Configuration | `bunfig.toml`, `[test]` section (`root = "."`); no extra test framework |
| Language | TypeScript, run directly by the runner (no compile step for tests) |
| Types | `tsconfig.json` (`strict`) plus `@types/bun`; static checks via `tsc --noEmit` |
| Mocking | Hand-written fakes behind the ports in `src/domain/ports.ts`; `Bun.serve` for HTTP stubs. No mocking library, no `mock.module` unless a case cannot be expressed through injection |
| Coverage reporting | `bun test --coverage` (report only — see coverage expectations) |

## Prerequisites

1. **Dependencies installed first**: run `bun install` from the workspace root. All five unit commands fail to start without it.
2. Run every command **from the workspace root** (`signal-demo/`), since test file paths are repo-relative.
3. Unit scope needs **no emulator, no Docker, no Postgres, no Ollama, no AWS credentials and no network**: every external boundary is a fake. (The emulator-level checks listed at the end of this file do need the containers; they are not unit tests and are not run as part of this scope.)
4. Tests receive configuration explicitly — they construct the env object (or use `tests/setup.ts` defaults) and call `loadConfig(env)`. No test reads the developer's real environment.

## Exact unit-scoped commands

Five test files, one command per file. These five commands are the complete unit scope for this stage target; run each once (do not add an aggregate command, which would execute the same files twice).

```bash
# Data model / database behaviour — T1–T3 (schema rendering, config-swapped dimensions, config errors)
bun test db/schema.test.ts

# Repository / data access — T4–T6 (item + vector round-trip, GSI access patterns, not-found)
bun test src/persistence/persistence.test.ts

# Business logic — T7–T9 (classify + embed, provider swap, clustering + summary, provider failure paths)
bun test src/business/business.test.ts

# API / endpoint — T10–T12 (ingest + retrieve + unauthenticated path, validation envelope, dashboard routes + filters)
bun test src/api/handlers.test.ts

# Frontend behaviour — T13–T15 (form payload builder, view models, drill-down and filter guards)
bun test src/dashboard/ui.test.ts
```

Static checks that accompany the unit scope (they are not tests but they gate the same files):

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # eslint flat config
```

Coverage report over exactly the unit scope (optional; `poc` sets no floor):

```bash
bun test --coverage db/schema.test.ts src/persistence/persistence.test.ts src/business/business.test.ts src/api/handlers.test.ts src/dashboard/ui.test.ts
```

## Coverage expectations

- **Strategy**: Minimal — one verifiable test per requirement at the narrowest effective level, at least one happy-path unit test per component, unit tests as the default. This stage plans **15 tests in 5 files**.
- **Scope floor**: `poc` adds **no** line-coverage floor and no CI execution requirement. Coverage is therefore **reported, never gated**: do not configure a threshold in `bunfig.toml` that the suite does not meet, and do not lower a threshold that exists to make a run pass.
- **Construction phase rule (mandatory)**: every test file covers the happy path and at least two error/edge cases — `db/schema.test.ts` (T1 happy, T2/T3 error+edge), `src/persistence/persistence.test.ts` (T4 happy, T5 edge, T6 error), `src/business/business.test.ts` (T7/T8 happy, T9 error pair), `src/api/handlers.test.ts` (T10/T12 happy, T11 error), `src/dashboard/ui.test.ts` (T13 happy, T14/T15 error+edge).
- **Requirement coverage**: FR1–FR6 each have a unit test; FR7.1, NFR1, NFR2 and NFR5 are verified at the emulator level by `bun run verify:infra` and `bun run smoke` (the narrowest effective level for infrastructure and end-to-end behaviour), and NFR4 is waived by the requirement. Build and Test must not substitute a weaker level for any of these.
- Tests must be green **and** meaningful: no tautological assertions, no assertions on source text, no test that passes for any implementation.

## Mocking and stubbing guidance

**Boundaries are ports, not modules.** `src/domain/ports.ts` defines `FeedbackRepository`, `VectorStore`, `LlmProvider`, `EmbeddingProvider` and `Clock`; every unit test injects a fake through the constructor of the unit under test. Real adapters are never constructed in unit scope.

| Boundary | Unit-test approach | Where the real implementation is exercised |
|---|---|---|
| LLM provider | `FakeLlmProvider` with a queued script of answers: a valid FR2.2 answer (T7), an out-of-enum answer that must trigger the single repair attempt and then a typed error (T9), and a thrown transport error (T9). Assert the error type and that nothing was persisted on failure | `bun run smoke` with Ollama |
| Embedding provider | `FakeEmbeddingProvider` returning a deterministic unit vector of `EMBEDDING_DIMENSIONS`; a wrong-dimension answer proves the dimension guard (T7/T8) | `bun run smoke` with Ollama; pgvector dimension check in `db:migrate` |
| Ollama HTTP mapping | When the adapter's request/response mapping itself is under test, start a `Bun.serve` stub on an ephemeral port and point `OLLAMA_BASE_URL` at it — real `fetch`, no library mocking, no network | not needed at emulator level beyond the smoke |
| Bedrock adapter | Inject a fake `BedrockRuntimeClient`-shaped object whose `send()` returns canned `body` bytes; assert the model id and the JSON request the adapter builds. No credentials, no network, ever (FR6 must not require AWS access in unit scope) | deliberately not exercised live (no Bedrock in the emulator; the spike forbids cloud credentials) |
| DynamoDB | In-memory `FeedbackRepository` fake that enforces the documented semantics: item round-trip (T4), GSI ordering and theme membership (T5), typed not-found (T6). Tests never reach `DynamoDBDocumentClient` | `bun run verify:infra` (table + GSIs) and `bun run smoke` (real writes/reads) |
| Postgres / pgvector | In-memory `VectorStore` fake with the same upsert/list semantics; schema correctness is asserted by rendering (T1–T3), not by a live database | `bun run db:migrate` against the pgvector container and `bun run smoke` |
| Clock | Always `fixedClock(<iso>)` from `tests/factories.ts`; no test may read the wall clock, so timestamps are deterministic (FR1.3) | smoke uses the real clock |

Rules: never stub a behaviour that the requirement cares about in a way that hides it (for example, never make the fake return an FR2.2-valid answer when the case under test is invalid provider output); assert on returned values and typed errors, not on internal call counts alone; if a fake and a real adapter disagree, the fake is the bug if the real one is correct.

## Test data management

- `tests/factories.ts` is the only place test data is constructed: `makeFeedbackInput`, `makeFeedbackItem`, `makeClassification`, `makeTheme`, `makeRun`, `makeVector`, `fixedClock`, and `plantCluster(store, count, spread, seed)` for deterministic planted embeddings.
- Every factory takes an overrides object, so each test states only what matters (`makeFeedbackInput({ text: "" })` for the invalid case).
- No shared mutable fixtures: each test builds its own repository/vector-store fake, so test order cannot matter.
- Deterministic by construction: fixed ids (`item-1`, `theme-1`), fixed timestamps from `fixedClock`, and a seeded generator for vectors. No `Math.random()`, no `Date.now()`, no sleeps.
- Fixture text is synthetic ("Checkout fails when the coupon field is empty"); no real customer data, no credentials, no personal data. `submitter_email` fixtures use `example.com`.
- No cleanup is required: unit scope allocates nothing outside the process.

## Emulator-level commands (not part of the unit scope)

Listed for completeness so Build and Test does not mistake them for unit tests — they require the containers started by `bun run emulator:up` and are the evidence path for FR7.1, NFR1, NFR2 and NFR5:

```bash
bun run db:migrate        # applies the rendered pgvector schema
bun run deploy            # CDK synth + CloudFormation deploy to http://localhost:4566
bun run verify:infra      # asserts every mandated emulator resource exists and is wired
bun run invoke:clustering # invokes the clustering Lambda through the emulator
bun run smoke             # end-to-end demo and NFR2/NFR3 measurements
```
