# Code Generation Plan — Build Signal

## Stage & Target

- **Intent**: `260927-signal-feedback-triage`; **scope**: `poc`; **depth**: Minimal; **test strategy**: Minimal; **project type**: Greenfield.
- **Target**: `AIDLC-STAGE: code-generation` — the active directive carries no `directive.unit` and there is no Unit DAG (`units-generation` is SKIP for `poc`). One implementation iteration; every artifact of this stage is written under `aidlc/spaces/default/intents/260927-signal-feedback-triage/construction/code-generation/` with no synthetic Unit segment. No Bolt, walking-skeleton, ladder, per-Unit receipt or swarm ceremony applies.
- **Application code location**: the workspace root (`signal-demo/`). The plan and the test instructions stay under this stage's record dir; nothing an application needs lives under `aidlc/`.
- **Inputs actually consumed**: `inception/requirements-analysis/requirements.md` (FR1–FR7, NFR1–NFR5, constraints, assumptions, out-of-scope) and `ideation/intent-capture/intent-statement.md` (success criteria, fixed constraints). Expected-but-absent by design for `poc`: `unit-of-work.md`, `functional-design/`, `nfr-requirements/`, `nfr-design/`, `infrastructure-design/`, `contract-design/` — none of their content is invented here; requirements are the design authority.
- **Scope of this dispatch**: PART 1 (planning) only. Generation (Step 4) begins only after the human answers Plan Approval through the stage's questions file; that gate belongs to the orchestrator.

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run that layer's tests.",
  "scope": "poc",
  "test_strategy": "minimal",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:c5db1280ba0333b655bcf97bdcaeaa0fd9cc0f50807a6ee879935b8aff3e17e0",
  "contract_sha256": "sha256:be5041ec2297dded1a31f328fae6a86555cf649f231018ea8168c9bb8dd811a5"
}
```

The block above is the command output of `bun .aidlc/tools/aidlc-testing-posture.ts render` pasted unchanged (only the surrounding headings are this plan's own). It is authoritative for Part 2: **test-after**, one implement/test pair per applicable testable layer, runner ready before the first test. `poc` adds no coverage floor and no extra new-test floor; the Minimal strategy and the Construction phase rule (each test file covers the happy path and at least two error/edge cases) together set the volume below.

## Proposed Stack — Decision and Rationale

The workspace is empty, so this plan **chooses** the stack. Every fixed constraint from the requirements is preserved: emulator at `http://localhost:4566`, API Gateway / Lambda / DynamoDB / EventBridge Scheduler / SES, Postgres with pgvector, IaC deployable to the emulator, zero cloud spend, provider swap by configuration only, SES configured but not used, unauthenticated ingestion.

| Concern | Decision | Requirement |
|---|---|---|
| Language / runtime | TypeScript 5.x compiled to CommonJS, running on the Lambda runtime `nodejs22.x`; runtime code uses Node APIs only (no Bun-specific APIs) | FR1–FR4, NFR5 |
| Local toolchain | `bun` for install / scripts / tests (already present in this environment); `tsc` for type-check and emit | NFR5 |
| HTTP surface | One **API Gateway REST API (v1)**, stage `local`, Lambda proxy integration. The same API also serves the static dashboard and the web form as `GET /` and `GET /app.js` | FR1.1, FR1.2, FR5.1, FR7.1 |
| Compute | Two Lambda functions: `signal-api` (ingest, item read, dashboard read, static assets) and `signal-clustering` (weekly job) | FR2, FR3, FR4, FR5, FR7.1 |
| Item / theme / run store | DynamoDB single table `signal-feedback`: PK/SK item collection plus three GSIs (urgency+created, category+created, theme+created) | FR1.4, FR4.3, FR5 |
| Vector store | Postgres 16 with the `vector` extension; one table `feedback_vectors`; cosine index | FR3.2, FR4.1, FR7.2 |
| LLM + embedding | Port/adapter: `LlmProvider` and `EmbeddingProvider` interfaces with an `ollama` adapter (default) and a `bedrock` adapter, selected per call from configuration | FR2.1, FR3.1, FR6.1, FR6.2 |
| Clustering algorithm | In-process greedy threshold clustering over cosine similarity (union-find), O(n²) for a few hundred items; theme summary written by the chat provider | FR4.1, FR4.2, NFR3, NFR4 |
| Configuration mechanism | Environment variables read at run time by `src/config/config.ts`; one committed `config/config.env` is the single source for both host scripts and the Lambda/emulator environments | FR6.1, FR6.2, FR7.2, NFR5 |
| IaC | AWS CDK v2 in TypeScript (`infra/`), synthesising a CloudFormation template; deploy transport is a TypeScript script using AWS SDK v3 against `http://localhost:4566` | FR7.1, FR7.2, NFR1 |
| Local infrastructure | Containers through the installed `docker` CLI (backed by `/run/podman/podman.sock` on this machine): the emulator, `pgvector/pgvector:pg16`, `ollama/ollama` | NFR1, NFR5 |
| Tests | `bun test` (built-in runner, Jest-compatible API), in-memory fakes for every port; 5 test files / 15 tests, no Docker, no network, no credentials | Minimal strategy |
| Static checks | `bun run typecheck` (`tsc --noEmit`) and `bun run lint` (ESLint flat config + `typescript-eslint`) | org Code Style |

### Why this stack

- **TypeScript on the Lambda Node runtime.** This stage's sensors run a linter and a type-check over TypeScript, the same language then covers application code, tests and IaC, and it is the Lambda first-class runtime. Alternatives rejected: Python (splits the toolchain and would need a second IaC language), Go/Rust (compile-and-package ceremony with no requirement asking for it), Java (start-up and packaging weight for a spike with a "few seconds" budget).
- **`bun` as toolchain.** Already installed here — `bun install`, `bun run`, `bun test` need no additional runner dependency, which keeps NFR5's "no network beyond the emulator and the configured local provider" true for anything after bootstrap. Alternative rejected: `npm` + Vitest adds install surface for no capability the spike needs.
- **REST API v1 over HTTP API v2.** The emulator's REST-API Lambda-proxy integration is the best-covered path and has a documented local alternative URL format for DNS-hostile machines. v2 is cheaper to describe but its `$default`-stage behaviour differs between emulator builds; that difference would sit directly on the demo's critical path.
- **Dashboard served by the same API.** Serving `index.html` / `app.js` from the API Lambda keeps the demo single-origin (no CORS configuration on a proxy-integrated API, no second local server process); the cost is bundling two static files into the `signal-api` asset. A separate static server was rejected as one more moving part with no requirement behind it.
- **DynamoDB for documents, pgvector for vectors.** The requirements fix both stores. DynamoDB holds feedback items, themes and weekly runs (GSI queries for urgent items, category filters and theme drill-down); Postgres holds only `item_id → embedding` with the cosine index used by clustering. Nothing is duplicated beyond the few attributes the dashboard filters and the clustering job groups on.
- **Greedy threshold clustering in process.** NFR4 explicitly waives scale, and NFR3 only asks for a few hundred items in minutes; an O(n²) cosine pass over a few hundred 768-dimension vectors is far inside that. A clustering or ML library would add a dependency — and a model-download risk — for no requirement.
- **CDK v2 for IaC, SDK-based deploy transport.** CDK defines all five mandated services in the application language and `cdk synth` produces a real, reviewable CloudFormation template. The transport matters more than the authoring tool here: this machine has **no AWS CLI, no `awslocal`, no `tflocal`, no `cdklocal`** (verified with `which`), so `scripts/deploy.ts` publishes the synthesised template with `@aws-sdk/client-cloudformation` and uploads the Lambda zips with `@aws-sdk/client-s3`, both pointed at `http://localhost:4566`. That needs nothing but npm dependencies and the emulator's own CloudFormation/S3 APIs. Recorded risk R5/R8 covers emulator-side resource support.
- **Provider swap by configuration (FR6.1/FR6.2).** `loadConfig(process.env)` runs on every invocation and returns a validated, immutable config object; `createLlmProvider(config)` / `createEmbeddingProvider(config)` map `LLM_PROVIDER`/`EMBEDDING_PROVIDER` (`ollama` | `bedrock`) to adapters. Nothing else in the codebase mentions a vendor: swapping providers is one environment-variable change plus a redeploy of the same artefact, and the swap is proven by unit tests that exercise the same call site with both settings.
- **Emulator identity is probed, not assumed.** Documentation read during planning shows the emulator landscape changed materially: LocalStack's community image was consolidated behind `LOCALSTACK_AUTH_TOKEN` (March 2026) and its EventBridge Scheduler support is licence-gated and, per its own docs, **mocked only — schedules are not executed and targets are never triggered**. Because a spike must not depend on an unverified licence or a paywalled mock, Step 13 starts the emulator behind `scripts/emulator-probe.ts`, which calls one API per mandated service (`DynamoDB CreateTable`, `API Gateway CreateRestApi`, `Lambda CreateFunction`, `Scheduler CreateSchedule`, `SES VerifyEmailIdentity`, `CloudFormation DescribeStacks`) at `http://localhost:4566` and records exactly which build/edition answered and which calls succeeded. The probe's outcome selects the emulator build (token-free emulator on `:4566` preferred, since NFR5 requires reproducibility with **no credentials**); risks R1–R5 describe every branch.

### Environment and configuration variables (single source: `config/config.env`)

`config/config.env` is committed (the spike holds no secrets) and is both loaded by host commands (`bun --env-file=config/config.env …`) and parsed by `infra/config.ts` to set Lambda environment variables. Container-internal host names differ from host names, so the file carries explicit pairs instead of hidden derivation:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `bedrock` — FR6.1 |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` or `bedrock` — FR6.1 |
| `OLLAMA_BASE_URL` / `OLLAMA_BASE_URL_LAMBDA` | `http://localhost:11434` / `http://ollama:11434` | local provider endpoint for host scripts / Lambda — NFR5 |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | classification and theme summary |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | embeddings (768 dimensions) |
| `BEDROCK_CHAT_MODEL` | `anthropic.claude-3-haiku-20240307-v1:0` | classification/summary when `bedrock` is selected |
| `BEDROCK_EMBED_MODEL` | `amazon.titan-embed-text-v2:0` | embeddings when `bedrock` is selected (1024 dimensions) |
| `AWS_REGION` | `us-east-1` | SDK region for emulator and Bedrock |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | emulator endpoint for DynamoDB / CloudFormation / S3 / Scheduler / SES |
| `EMBEDDING_DIMENSIONS` | `768` | vector column width; must match the selected embedding model |
| `FEEDBACK_TABLE` | `signal-feedback` | DynamoDB table name |
| `DATABASE_URL` / `DATABASE_URL_LAMBDA` | `postgres://signal:signal@localhost:5432/signal` / `…@postgres:5432/signal` | pgvector connection for host scripts / Lambda — FR7.2 |
| `CLUSTER_SIMILARITY_THRESHOLD` | `0.82` | cosine threshold for joining a theme |
| `CLUSTER_MIN_SIZE` | `2` | themes below this size are not persisted |
| `CLUSTER_WINDOW_DAYS` | `7` | look-back window of the weekly job |
| `DASHBOARD_TREND_WEEKS` | `8` | weeks shown in the trend view |
| `SCHEDULE_CRON` | `cron(0 6 ? * MON *)` | weekly EventBridge Scheduler expression |
| `SES_SENDER` | `signal@example.com` | SES identity — configured, never used |
| `API_STAGE_NAME` | `local` | API Gateway stage |
| `LOCAL_API_URL_STYLE` | `_aws_execute_api` | which local invoke URL form the smoke script builds |

## Architecture Sketch

```mermaid
flowchart LR
  A[Web form and dashboard] -->|HTTP| B[API Gateway REST local]
  C[API clients] -->|POST feedback| B
  B --> D[Lambda signal-api]
  D --> E[DynamoDB signal-feedback]
  D --> F[Postgres plus pgvector]
  D --> G[Provider port Ollama or Bedrock]
  H[EventBridge Scheduler weekly] -.-> I[Lambda signal-clustering]
  I --> F
  I --> E
  I --> G
```

Text fallback: the web form and any API client call the emulated API Gateway; its Lambda proxy integration invokes `signal-api`, which classifies and embeds through the provider port, writes the item to DynamoDB and the vector to Postgres. A weekly EventBridge Scheduler schedule targets `signal-clustering`, which reads the vector window from Postgres, clusters it, writes themes plus a summary to DynamoDB, and the dashboard endpoints read those back through `signal-api`.

## Requirement → Step / Test Traceability

Every plan step names the requirement IDs it implements. Test IDs are defined in "Test Plan" below; "verification" names the narrowest effective level.

| Requirement | Implementing step(s) | Test / verification |
|---|---|---|
| FR1.1 (POST JSON payload, `source`/`text`/optional `submitter_email`/`product_area`) | Step 7 (validation), Step 9 (route) | T10, T11 |
| FR1.2 (same payload shape from the web form) | Step 11 (form builder) | T13 |
| FR1.3 (server-side timestamp) | Step 7 (injected clock), Step 9 | T10 |
| FR1.4 (persist and retrieve by identifier) | Step 5 (repository), Step 9 (`GET /feedback/{id}`) | T4, T6, T10 |
| FR1.5 (ingestion unauthenticated) | Step 9 (no auth on the API) | T10 (request carries no credentials and still succeeds) |
| FR2.1 (classify through the configured provider) | Step 7 (enrichment + provider port) | T7, T9 |
| FR2.2 (fixed category/sentiment/urgency value sets) | Step 3 (domain enums), Step 7 (coercion) | T7, T8 |
| FR2.3 (values stored as strings, used verbatim, no free-form) | Step 3, Step 7 | T7, T9, T12 |
| FR3.1 (embed through the configured provider) | Step 7 | T7, T9 |
| FR3.2 (vector associated with its item) | Step 5 (vector store), Step 7 | T4 |
| FR4.1 (weekly scheduled clustering by similarity) | Step 14 (Scheduler resource), Step 7 (clustering), Step 9 (job entrypoint) | T8, Step 15 smoke, `verify:infra` |
| FR4.2 (short summary of what changed / needs attention) | Step 7 (summariser) | T8 |
| FR4.3 (themes and summaries persisted for the dashboard) | Step 5 (theme/run items), Step 7 | T5, T8 |
| FR5.1 (dashboard shows themes, trends, urgent items) | Step 7 (aggregation), Step 9 (routes), Step 11 (UI) | T12, T14 |
| FR5.2 (drill-down to raw items) | Step 5 (theme membership query), Step 9, Step 11 | T5, T12, T15 |
| FR5.3 (filtering uses the FR2.2 values) | Step 7 (filter validation), Step 11 (filter controls) | T5, T12, T14, T15 |
| FR6.1 (provider selectable between Ollama and Bedrock by configuration) | Step 7 (factory) | T2, T7 (same call site, two configs, no code change) |
| FR6.2 (read from configuration at run time) | Step 1 (`loadConfig`), Step 7 | T1, T2, T7 |
| FR7.1 (API Gateway, Lambda, DynamoDB, Scheduler, SES as code, deployable to `:4566`) | Step 14 (CDK + deploy + verify) | `bun run verify:infra` against the emulator (narrowest effective level for IaC), Step 15 smoke |
| FR7.2 (Postgres/pgvector provisioned; connection details from configuration) | Step 3 (schema), Step 13 (container), Step 1 (`DATABASE_URL`) | T1, T2, T3, Step 13 migrate run |
| NFR1 (everything local on the emulator, zero cloud spend) | Step 13, Step 14, Step 15 | Step 15 smoke — all calls resolved to `http://localhost:4566` |
| NFR2 (classify + embed one item in a few seconds) | Step 7 | Step 15 smoke asserts the measured per-item latency of the integration run |
| NFR3 (weekly job in minutes for a few hundred items) | Step 7 | T8 (synthetic 300-vector sanity bound), Step 15 smoke |
| NFR4 (no concurrency/availability/durability targets) | — (waived by the requirement) | recorded as waived in the code summary; no test invented for it |
| NFR5 (reproducible locally, no cloud credentials, no network beyond the emulator and the local provider) | Step 1, Step 13 | T3 (config refuses to invent credentials), Step 15 smoke environment check |

## Test Plan — Minimal strategy

5 test files, 15 tests. Every file covers the happy path plus at least two error/edge cases; every FR has at least one test at the narrowest effective level; NFR1/NFR2/NFR5 are demonstrated by the end-to-end smoke, which is the narrowest level at which they are observable.

| ID | File | Test intent |
|---|---|---|
| T1 | `db/schema.test.ts` | happy — pgvector migration rendered from config contains the extension, the `feedback_vectors` table with `vector(768)`, the cosine index and idempotent guards; the DynamoDB key/GSI design exposes items, themes, runs and the three GSIs (FR7.2, FR6.2) |
| T2 | `db/schema.test.ts` | edge — switching to `EMBEDDING_PROVIDER=bedrock` with `EMBEDDING_DIMENSIONS=1024` changes the rendered schema with no code change (FR6.1, FR6.2) |
| T3 | `db/schema.test.ts` | error — a missing `DATABASE_URL` or a non-numeric/zero `EMBEDDING_DIMENSIONS` makes `loadConfig` fail with an error naming the variable, never a silently invented default (FR7.2, NFR5) |
| T4 | `src/persistence/persistence.test.ts` | happy — item round-trip through the repository port keeps the classification and the vector association metadata; a vector upsert for the same `item_id` is idempotent (FR1.4, FR3.2) |
| T5 | `src/persistence/persistence.test.ts` | edge — GSI queries answer the dashboard's access patterns: urgent items newest-first, theme drill-down membership, category filter (FR4.3, FR5.2, FR5.3) |
| T6 | `src/persistence/persistence.test.ts` | error — reading an unknown identifier fails with a typed not-found error, not a generic error and not `undefined` (FR1.4) |
| T7 | `src/business/business.test.ts` | happy — one item is classified into the FR2.2 enumerations verbatim and embedded to the configured dimensions; the same call site returns the Ollama adapter under `LLM_PROVIDER=ollama` and the Bedrock adapter under `LLM_PROVIDER=bedrock` (FR2.1–FR2.3, FR3.1, FR6.1, FR6.2) |
| T8 | `src/business/business.test.ts` | happy — planted similar vectors cluster into the expected themes, a summary string is produced and the themes plus run are handed to the repository; 300 synthetic vectors cluster inside the job's sanity bound (FR4.1–FR4.3, NFR3) |
| T9 | `src/business/business.test.ts` | error — an out-of-enum provider answer triggers one repair attempt and then a typed error, and no free-form value is ever stored; a provider transport failure surfaces as a typed error naming the provider (FR2.1, FR2.3, FR3.1) |
| T10 | `src/api/handlers.test.ts` | happy — an unauthenticated `POST /feedback` with the web payload returns 201 with a server-side timestamp and the classification, and `GET /feedback/{id}` returns the same item (FR1.1, FR1.3, FR1.4, FR1.5) |
| T11 | `src/api/handlers.test.ts` | error — blank `text`, an unknown field, an invalid `source` and an over-long `text` each return the documented 400 error envelope (FR1.1) |
| T12 | `src/api/handlers.test.ts` | happy + edge — dashboard read routes return themes, trends and urgent items and accept only FR2.2 filter values; an unknown filter value returns 400 (FR5.1, FR5.3) |
| T13 | `src/dashboard/ui.test.ts` | happy — the web-form payload builder emits exactly the API payload with `source: "web"` (FR1.2) |
| T14 | `src/dashboard/ui.test.ts` | edge — the view-model builder renders themes, trends and urgent lists from an API payload, including the empty-corpus state, and its filter controls carry the FR2.2 values (FR5.1, FR5.3) |
| T15 | `src/dashboard/ui.test.ts` | error — drill-down and filter mapping reject an unknown theme id and an unknown filter value instead of issuing a malformed request (FR5.2, FR5.3) |

Volume accounting: 15 tests ≥ the 7 FRs and the observable NFRs, inside the Minimal strategy's requirement-driven volume; each file meets the Construction rule of one happy path plus two error/edge cases (T5/T6, T8/T9, T11/T12, T14/T15 pairs), and no test is a tautology or a copy of source text.

## Plan Steps

### Step 1 — Project structure and production configuration skeleton *(FR6.2, FR7.2, NFR5)*

- [x] Initialise `package.json` (name `signal-demo`, `"type": "commonjs"`, scripts: `build`, `typecheck`, `lint`, `test`, `db:migrate`, `emulator:up`, `emulator:probe`, `deploy`, `verify:infra`, `invoke:clustering`, `smoke`), `tsconfig.json` (strict, `NodeNext` module resolution, `noUncheckedIndexedAccess`), `tsconfig.build.json` (emit to `dist/`), `bunfig.toml` (`[test]` section: `root = "."`), `eslint.config.js`, `.gitignore` (add `dist/`, `build/`, `node_modules/`, `.env`, `cdk.out/`).
- [x] Install dependencies: runtime `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-cloudformation`, `@aws-sdk/client-s3`, `@aws-sdk/client-scheduler`, `@aws-sdk/client-ses`, `@aws-sdk/client-api-gateway`, `@aws-sdk/client-lambda`; `pg`, `zod`; dev `typescript`, `@types/node`, `@types/pg`, `esbuild`, `eslint`, `typescript-eslint`, `aws-cdk-lib`, `constructs`, `@types/bun`. (Installed 182 packages; `client-apigateway` in this bullet is not a published package — the real name is `@aws-sdk/client-api-gateway`.)
- [x] Write `src/config/config.ts`: typed `Config`, `loadConfig(env)` validating required variables, failing loudly with the variable name, and reading everything at call time (FR6.2); no module-level `process.env` capture.
- [x] Write `config/config.env` with the full variable table above (no secrets are in scope), plus `.gitignore` entry only if a local override file is ever added.
- [x] Write `README.md` skeleton with the prerequisite list and the run order (filled in at Step 16).

### Step 2 — Bootstrap the minimal test runner and record the exact unit-scoped command *(Minimal strategy; contract `runner_step`)*

- [x] Configure the runner: `bun test` with the `[test]` block in `bunfig.toml`; no extra test framework, no coverage gate (`poc` adds no coverage floor).
- [x] Add `tests/factories.ts`: `makeFeedbackInput`, `makeFeedbackItem`, `makeVector`, `makeTheme`, `makeRun`, deterministic vector planters (`plantCluster`), and a `fixedClock` — shared builders only, never mutable shared state.
- [x] Bootstrap the runner before any test exists: `bunfig.toml` and `tests/factories.ts` load cleanly (`bun run typecheck` covers the factory imports). Runner readiness is proven for real when the first layer command runs green in Step 4 — no placeholder or throwaway test file is created.
- [x] Record all five unit-scoped commands in `unit-test-instructions.md` (written as this plan's companion artifact).

### Step 3 — Data model / database behaviour: implement *(FR2.2, FR4.3, FR7.2)*

- [x] `src/domain/types.ts`: `CATEGORIES`, `SENTIMENTS`, `URGENCIES` literal unions and arrays (FR2.2), `FeedbackInput`, `Classification`, `FeedbackItem`, `Theme`, `WeeklyRun`, `Result<T, E>`, and `schemaVersion`.
- [x] `src/persistence/dynamo-keys.ts`: the single-table key design — `ITEM#<id>` / `META`, `THEME#<runId>#<themeId>` / `META`, `RUN#<runId>` / `META`, plus GSI attribute projections `gsi_urgency_created`, `gsi_category_created`, `gsi_theme_created` (FR5.2, FR5.3, FR4.3).
- [x] `src/persistence/pg-schema.ts`: render the migration SQL from configuration (`vector(<EMBEDDING_DIMENSIONS>)`, `CREATE EXTENSION IF NOT EXISTS vector`, idempotent table/index statements, cosine index `vector_cosine_ops`) (FR7.2).
- [x] `db/migrations/001_init.sql`: the canonical template the renderer fills; `scripts/db-migrate.ts` applies the rendered statements through `pg` and prints what it did (FR7.2).

### Step 4 — Data model / database behaviour: write and run its tests *(`bun test db/schema.test.ts` → T1–T3)*

- [x] Write `db/schema.test.ts` (T1–T3).
- [x] Run `bun test db/schema.test.ts` and keep green. (3 pass / 0 fail, 35 expect() calls.)
- [x] Defer the live half of this layer to Step 13 (containers first, then reality): run `bun run db:migrate` against the pgvector container and confirm the extension, table and index exist. (Ran: extension `vector` 0.8.6, column `vector(768)`, `feedback_vectors_embedding_idx` using `hnsw (embedding vector_cosine_ops)` and `feedback_vectors_created_at_idx` using btree — all verified.)

### Step 5 — Repository / data access: implement *(FR1.4, FR3.2, FR4.3, FR5.2, FR5.3, FR7.2)*

- [x] `src/domain/ports.ts`: `FeedbackRepository`, `VectorStore`, `Clock`, plus `NotFoundError` / `ProviderError` / `ProviderOutputError` / `ConfigError` / `ValidationError`. (`ConfigError` stays defined in `src/config/config.ts` and is re-exported here so the domain error set has one import site.)
- [x] `src/persistence/dynamo-repository.ts`: `putItem`, `getItemById`, `queryUrgent(limit)`, `queryByCategory(category, limit)`, `queryByTheme(themeId, limit)`, `putTheme`, `putRun`, `listRuns(limit)`, `listThemes(runId)` via `DynamoDBDocumentClient` with `endpoint`/`region` from configuration (FR1.4, FR4.3, FR5.2, FR5.3). (`queryUrgent` takes an optional `urgency` so the FR2.2 urgency filter can select; `listRuns`/`listThemes` use a bounded `Scan` because the approved key design gives each run/theme its own partition — documented in the module header.)
- [x] `src/persistence/pgvector-store.ts`: `upsert(itemId, vector, meta)`, `listWindow(since)`, `querySimilar(vector, limit)` using `vector_cosine_ops` (FR3.2, FR4.1); connections from `DATABASE_URL`, closed per invocation.
- [x] Both adapters implement the ports so tests can substitute in-memory fakes. (Fakes live in `src/persistence/in-memory.ts`; shared cosine maths in `src/domain/vector-math.ts`.)

### Step 6 — Repository / data access: write and run its tests *(`bun test src/persistence/persistence.test.ts` → T4–T6)*

- [x] Write `src/persistence/persistence.test.ts` against in-memory fakes that enforce the same contract (including GSI ordering and not-found semantics) (T4–T6). (Also asserts the real adapter's encode/decode round-trip and the index each query targets, using a recording document client — no network.)
- [x] Run `bun test src/persistence/persistence.test.ts` and keep green. (3 pass / 0 fail, 32 expect() calls.)
- [x] Smoke the real adapters once against the emulator and the pgvector container (via `bun run verify:infra`-independent one-off), so a port/adaptor mismatch cannot hide until Step 15. (One `POST /feedback` straight at the emulated API hit `dynamodb.PutItem => 200` and the pgvector upsert, and returned 201; the whole round trip is then repeated by `bun run smoke`.)

### Step 7 — Business logic: implement *(FR1.1, FR1.3, FR2, FR3, FR4, FR5.1–FR5.3, FR6.1, FR6.2, NFR2, NFR3)*

- [x] `src/domain/validation.ts`: zod schema for the ingest payload — `text` non-empty and length-bounded, `source` ∈ {api, web}, optional `submitter_email` (format-checked), optional `product_area`, unknown fields rejected (FR1.1).
- [x] `src/providers/types.ts` + `src/providers/ollama.ts`: chat call to `/api/chat` with a JSON-only classification prompt and embeddings call to `/api/embeddings`; timeouts and non-2xx surfaces as `ProviderError` (FR2.1, FR3.1). (Embeddings try the current `/api/embed` first and fall back to the legacy `/api/embeddings` on a 404.)
- [x] `src/providers/bedrock.ts`: `InvokeModel` through `@aws-sdk/client-bedrock-runtime` for both classification and embeddings, model ids and region from configuration (FR2.1, FR3.1, FR6.1).
- [x] `src/providers/factory.ts`: `createLlmProvider(config, deps)` / `createEmbeddingProvider(config, deps)` selecting `ollama` or `bedrock` and failing fast on an unknown value (FR6.1, FR6.2).
- [x] `src/business/enrichment.ts`: parse the model answer, accept only FR2.2 values verbatim, one repair attempt, then `ProviderOutputError`; embed and return `{classification, vector}`; timestamp from the injected `Clock` (FR2.2, FR2.3, FR3.1, FR1.3). (Returns `{classification, vector, classifiedAt}` — the single server-side timestamp used as `createdAt`.)
- [x] `src/business/clustering.ts`: cosine similarity, threshold join, minimum size, deterministic theme ids/labels, theme members (FR4.1). (Shared `cosineSimilarity` lives in `src/domain/vector-math.ts`.)
- [x] `src/business/summarise.ts`: one chat call producing the short "what changed / what needs attention" summary (FR4.2).
- [x] `src/business/dashboard.ts`: aggregation of themes, trends (per-week counts across `DASHBOARD_TREND_WEEKS`) and urgent items, plus drill-down by theme id and filter validation against FR2.2 values (FR5.1–FR5.3).
- [x] `src/business/job.ts`: orchestrate the weekly run — window from Postgres, cluster, summarise, persist run plus themes (FR4.1–FR4.3).

### Step 8 — Business logic: write and run its tests *(`bun test src/business/business.test.ts` → T7–T9)*

- [x] Write `src/business/business.test.ts` using `FakeLlmProvider` / `FakeEmbeddingProvider` (one deterministic fake answer per test, including a deliberately invalid one) and in-memory repository/vector fakes (T7–T9). (Fakes live in `tests/fakes.ts`.)
- [x] Run `bun test src/business/business.test.ts` and keep green. (3 pass / 0 fail, 41 expect() calls; the 300-vector NFR3 sanity run measured 5–6 ms.)

### Step 9 — API / endpoint layer: implement *(FR1.1–FR1.5, FR4.1, FR5.1–FR5.3)*

- [x] `src/api/errors.ts`: the documented error envelope `{error: {code, message, details?, requestId}}` and the mapping from typed errors to status codes (400 validation, 404 not found, 502 provider). (Body decoding and its 64 KiB bound live in `src/api/request-body.ts`.)
- [x] `src/api/routes.ts`: `POST /feedback`, `GET /feedback/{id}`, `GET /dashboard/themes`, `GET /dashboard/trends`, `GET /dashboard/urgent`, `GET /themes/{id}/items`, `GET /health`, `GET /` and `GET /app.js` (static dashboard), no authentication anywhere (FR1.5, FR5.1–FR5.3). (`/styles.css` is served by the same static route, which the dashboard needs.)
- [x] `src/api/handler.ts`: API-Gateway-proxy shaped handler — parse, validate, enrich, persist (item to DynamoDB, vector to Postgres), respond 201; dependency-injected ports so tests never touch a network (FR1.1–FR1.4).
- [x] `src/lambda/api-lambda.ts` and `src/lambda/clustering-lambda.ts`: thin entrypoints wiring `loadConfig` to the adapters (FR4.1). (Shared composition root: `src/lambda/dependencies.ts`.)

### Step 10 — API / endpoint: write and run its tests *(`bun test src/api/handlers.test.ts` → T10–T12)*

- [x] Write `src/api/handlers.test.ts` driving the handler with proxy-shaped events and fake ports (T10–T12).
- [x] Run `bun test src/api/handlers.test.ts` and keep green. (3 pass / 0 fail, 58 expect() calls.)

### Step 11 — Frontend behaviour: implement *(FR1.2, FR5.1–FR5.3)*

- [x] `dashboard/static/index.html`: the submit form (fields mirroring FR1.1, `data-testid` attributes per the automation-friendly naming rule) and the dashboard sections for themes, trends and urgent items with a drill-down view and filter controls whose values come from FR2.2.
- [x] `dashboard/static/app.js`: pure builders (`buildSubmitPayload`, `buildFilters`, `buildThemeView`, `buildTrendView`, `buildUrgentView`, `buildDrilldownRequest`) plus a thin DOM renderer; no framework, no chart library, no external asset (NFR5). (Also `buildQueryRequest` for the filter mapping and `buildDashboardViewModel` for the empty state; the DOM renderer is guarded so importing the module in a test touches no browser API.)
- [x] `dashboard/static/styles.css`: minimal layout; trend bars as inline elements rather than a chart dependency.

### Step 12 — Frontend behaviour: write and run its tests *(`bun test src/dashboard/ui.test.ts` → T13–T15)*

- [x] Write `src/dashboard/ui.test.ts` covering the pure builders (T13–T15); DOM rendering itself is deliberately not unit-tested — its narrowest effective verification is the Step 15 smoke fetching `GET /` and `GET /app.js` from the emulated API and asserting the served markers. (T14 also cross-checks the bundle's FR2.2 filter values against `src/domain/types.ts`, so the two cannot drift.)
- [x] Run `bun test src/dashboard/ui.test.ts` and keep green. (3 pass / 0 fail, 26 expect() calls.)

### Step 13 — Environment / build configuration *(NFR1, NFR2, NFR5, FR7.2)*

- [x] `compose.yaml` + `scripts/emulator-up.sh`: start three containers on one user-defined network — the emulator (`:4566`, docker socket mounted for Lambda execution, `LAMBDA_DOCKER_NETWORK` set to that network so function containers resolve `postgres` and `ollama` by name), `pgvector/pgvector:pg16` (alias `postgres`), `ollama/ollama` (alias `ollama`); script pulls images, pulls `OLLAMA_CHAT_MODEL` and `OLLAMA_EMBED_MODEL` into the Ollama container, waits for readiness, and prints what it started. (The network is named explicitly — `signal-demo_signal-net` — so `LAMBDA_DOCKER_NETWORK` can reference the exact string; the script also starts the Podman user socket when the daemon is unreachable, and fails loudly if it still cannot connect.)
- [x] `scripts/emulator-probe.ts`: one call per mandated service against `http://localhost:4566` (CreateTable/DescribeTable, CreateRestApi, CreateFunction with a role ARN in `arn:aws:iam::000000000000:role/…` form, CreateSchedule, VerifyEmailIdentity, DescribeStacks) plus a Bedrock probe that records "not available locally" — output is a capability table the runbook and the code summary quote; nothing is assumed to work because the API exists. (Also probes S3, which the deploy transport needs.)
- [x] `scripts/build-lambda.ts`: esbuild bundles `src/lambda/api-lambda.ts` and `src/lambda/clustering-lambda.ts` for `--platform=node --target=node22 --external:pg-native`, copies `dashboard/static/**` into the API asset, and writes `build/api.zip` / `build/clustering.zip` (FR7.1). (A small dependency-free ZIP writer lives in `scripts/zip.ts`; the AWS SDK is external because the Node 22 runtime provides it.)
- [x] `bun run typecheck` and `bun run lint` green for everything written so far.

### Step 14 — Infrastructure as code and emulator deployment *(FR7.1, FR7.2, NFR1)*

- [x] `infra/config.ts`: reads `config/config.env` and derives the Lambda environments (the `_LAMBDA` variants), the stage name, the cron and the SES sender — one source, no drift. (`AWS_ENDPOINT_URL_LAMBDA` was added to `config/config.env`: Lambda containers must reach the emulator by its compose network alias, not by the host port.)
- [x] `infra/lib/signal-stack.ts`: `AWS::DynamoDB::Table` (PK/SK plus the three GSIs), two `AWS::Lambda::Function` resources with the zip assets, an IAM role whose ARN uses account `000000000000`, `AWS::ApiGateway::RestApi` + resource/method/integration (Lambda proxy) + deployment + stage `local` + Lambda permission, `AWS::Scheduler::Schedule` with the configured cron and the clustering function as target plus its role, and an SES identity/config set for `SES_SENDER` that nothing sends through (FR7.1, SES unused). (Lambda code is an explicit S3 bucket/key rather than a CDK asset, because `cdk-assets` publishing needs a bootstrapped account the spike cannot have; `scripts/deploy.ts` uploads the zips.)
- [x] `infra/bin/app.ts`: CDK app entry (`cdk synth` produces `cdk.out/`). (There is no `cdk` CLI on this machine, so the app is synthesised programmatically via `infra/lib/signal-app.ts`; `bun run cdk:synth` runs it and writes `cdk.out/SignalStack.template.json`.)
- [x] `scripts/deploy.ts`: `cdk synth` → upload the two zips to an emulator S3 bucket → `CreateStack` (then `DescribeStacks` to completion) with the synthesised template and the S3 locations → write `.signal-stack.json` holding stack outputs (REST API id, stage, function names, table name, schedule name, S3 bucket) for the later scripts (FR7.1, NFR1).
- [x] `scripts/verify-infra.ts`: assert against the emulator that every mandated resource exists and is wired (table plus GSIs, both functions active, REST API deployed with the proxy route, schedule present targeting the clustering function, SES identity present), and print a table; if the emulator refuses a resource type, print the capability gap as a failure rather than substituting a different resource silently (FR7.1).
- [x] Run `bun run deploy` then `bun run verify:infra`; record the probe and verify output for the completion evidence. (Deploy created the stack `signal-stack` (CREATE_COMPLETE) with REST API `d5e1jffnf1` and stage `local`; `verify:infra` then reported 9/9 PASS. Two real emulator gaps were found and fixed during this step — the service list lacked `iam`, `logs` and `ssm`, and the probe/stack needed the runtime the emulator's enum accepts (`nodejs20.x`, not `nodejs22.x`).)

### Step 15 — End-to-end smoke against the emulator *(NFR1–NFR3, NFR5, FR1–FR5)*

- [x] `scripts/smoke.ts`: (1) assert the environment holds no AWS credentials and every endpoint resolves to `http://localhost:4566`; (2) `POST /feedback` through the emulated API Gateway twice — once as `source: "api"`, once as the exact web-form payload — and assert 201, server timestamps, FR2.2 classification values and `GET /feedback/{id}`; (3) measure classification+embed latency per item and assert the NFR2 budget; (4) `scripts/invoke-clustering.ts` invokes the deployed clustering Lambda through the emulator and asserts a run plus themes with a summary were persisted and that the job finished inside the NFR3 budget; (5) fetch `GET /dashboard/themes`, `/trends`, `/urgent` and one `GET /themes/{id}/items` drill-down, plus `GET /` and `GET /app.js` for the served dashboard markers; (6) print a single pass/fail report with the resolved URLs. (Also seeds six synthetic items so the weekly job has something to cluster; `LOCAL_API_URL_STYLE` selects the invoke URL form and the script prints the URL it used — risk R10.)
- [x] Run `bun run smoke` end to end; keep the transcript as the stage's verification evidence, and re-run it after any later change. (16/16 checks passed: NFR2 worst per-item classify+embed latency 1565 ms against a 10 s budget; NFR3 job 7440 ms against a 120 s budget; 2 themes with a written summary; drill-down, trends, urgent, filter validation and the served dashboard all green.)

### Step 16 — Documentation and traceability *(all requirements; stage artifacts)*

- [x] `README.md`: prerequisites, the container bootstrap, `db:migrate`, `deploy`, `verify:infra`, `smoke`, the variable table, the provider-swap recipe (`LLM_PROVIDER`/`EMBEDDING_PROVIDER` in one environment file — no code change), and an explicit limitations section listing the probe-confirmed emulator gaps. (The limitations section now names the measured facts: the `_user_request_` URL form, the `nodejs20.x` runtime, the extra `iam`/`logs`/`s3`/`ssm` services, the missing sesv2 API, the mocked scheduler and the unverifiable Bedrock path; the measured NFR2/NFR3 numbers are tabulated too.)
- [x] Inline module documentation for the non-obvious parts: clustering thresholds, GSI design, provider answer parsing/repair, the emulator URL styles. (Every module carries a header explaining its boundary and its non-obvious choices; the clustering cost model is in `src/business/clustering.ts`, the sparse-GSI design in `src/persistence/dynamo-keys.ts`, the one-repair-attempt rule in `src/business/enrichment.ts`, and the URL-style finding in `config/config.env`, `scripts/smoke.ts` and `README.md`.)
- [x] Write `source-manifest.json` listing every application path created/modified (application code, tests, IaC, scripts, config, dashboard assets).
- [x] Write `traceability.json` mapping every FR and observable NFR to its implementation or test file, and `code-summary.md` with files, decisions, test results and deviations.

## Deliberate Deviations from the Contract's Ordering Baseline

1. **Two extra steps after the baseline's frontend pair** — Step 14 (IaC and emulator deployment) and Step 15 (end-to-end smoke). The architecture requires them before the documentation step: FR7.1 and NFR1–NFR3 are only observable once the stack exists on the emulator, and the ordering baseline's "Environment/build configuration / Documentation" pair cannot carry a deployment gate. Requirements for the environment are unchanged; only ordering is extended.
2. **Frontend behaviour has one implement step and one test step, like the baseline**, but its tests cover the pure builders rather than DOM rendering — `poc`'s Minimal strategy has no DOM runner in its dependency set, and the real rendering path is exercised by Step 15 against the emulated API.
3. **Build and Test is not used to create tests.** All 15 tests are written in this stage, per the stage rule; Build and Test verifies and extends.

## Risks and Unverified Assumptions

Nothing below is assumed to work. Items marked *checked* were verified during planning with the exact method named; the rest are risks with a stated mitigation and a place where the outcome is recorded.

- **R1 — Emulator identity, licence and auth (highest risk).** *Checked:* the emulator landscape changed in 2026 — `localstack/localstack:latest` consolidated into an image that requires `LOCALSTACK_AUTH_TOKEN`, and EventBridge Scheduler is documented as "available starting with the Hobby plan". No token, no LocalStack CLI and no running emulator were found on this machine (*checked:* `which …`; `/proc/net/tcp` shows nothing listening on 4566, 5432 or 11434; the podman image store holds no images). *Mitigation:* Step 13 boots the emulator behind a capability probe and prefers a token-free emulator that serves the same five services on `:4566`, because NFR5 demands reproducibility with no credentials. If only an authenticated build is available, the gap is surfaced to the human at completion instead of silently demanding an account.
- **R2 — Scheduler execution is mocked.** *Checked:* the emulator's own documentation states EventBridge Scheduler "only provides mocked functionality… does not emulate actual features such as schedule execution or target triggering". *Mitigation:* the demo never waits for a schedule — it invokes the clustering Lambda directly through the emulator's Invoke API, while the schedule resource itself is asserted by `verify:infra`. A mocked scheduler therefore cannot invalidate FR4's demonstration, and cannot turn FR7.1 into a silent pass either.
- **R3 — Cold bootstrap needs the network.** *Checked:* no emulator, pgvector or Ollama image is cached and no Postgres or Ollama binary exists locally, so the first `emulator:up` pulls container images and Ollama models. NFR5's "no network beyond the emulator and the local provider" applies to running the demo, not to provisioning it; the README states the pull as a prerequisite, and the smoke asserts credentials-free, emulator-only traffic at run time.
- **R4 — Lambda-to-Postgres/Ollama reachability.** The emulator runs function code in its own containers; `LAMBDA_DOCKER_NETWORK` is documented as the supported option, and this machine's Docker socket is podman-backed (`/var/run/podman/podman.sock`), which is plausible but unverified for nested container networking. *Mitigation:* one user-defined network with the aliases `postgres` and `ollama`; fallback to `host.docker.internal` with `--add-host host.docker.internal:host-gateway`; the failure is visible immediately in the Step 15 smoke rather than at the end.
- **R5 — CloudFormation coverage for specific resource types.** Whether the chosen emulator deploys `AWS::Scheduler::Schedule` and the SES resources through CloudFormation is unverified. *Mitigation:* `emulator-probe.ts` checks the service APIs first, `verify:infra` checks the deployed resources second; an unsupported CloudFormation type is reported as a gap and provisioned through its service API from the same CDK-described configuration, with the substitution printed — never hidden.
- **R6 — Local model availability and NFR2 latency.** No Ollama binary exists here and CPU-only inference latency is unknown. *Mitigation:* small default models (`llama3.2:3b`, `nomic-embed-text`), every model id configurable, and the smoke measures the real per-item latency so the NFR2 budget is reported as measured fact; if the machine cannot serve the model, the gap is surfaced — a stub provider is not substituted into the demo path.
- **R7 — The Bedrock path cannot be exercised locally.** The emulator has no Bedrock and the spike forbids cloud credentials, so FR6.1/FR6.2 are proven by configuration-driven selection tests plus code inspection; the live Bedrock call is explicitly not demonstrated. *Mitigation:* the adapter is thin and its request/response mapping is unit-tested against an injected fake client; the limitation is stated in `README.md` and `code-summary.md`.
- **R8 — SDK endpoint override behaviour.** `AWS_ENDPOINT_URL`/`endpoint` support per client against the emulator is documented but unverified here for Scheduler, SES and CloudFormation. *Mitigation:* the probe reports per-service results before anything depends on them.
- **R9 — Host/container configuration drift.** Two value sets (host versus Lambda) can diverge. *Mitigation:* one committed `config/config.env` with explicit `_LAMBDA` pairs, parsed by `infra/config.ts`; `verify:infra` and the smoke both read the same file.
- **R10 — Local API invoke URL form.** Emulator builds differ between `http://<apiId>.execute-api.localhost.localstack.cloud:4566/<stage>/<path>` and `http://localhost:4566/_aws/execute-api/<apiId>/<stage>/<path>`; the older `/restapis/<id>/<stage>/_user_request_/` form also appears in the wild. *Mitigation:* `LOCAL_API_URL_STYLE` selects the form and the smoke prints the URL it used; DNS-dependent forms are avoided by default.
- **R11 — Spike acceptance is unowned.** Who accepts the spike and against what threshold beyond NFR5 is unresolved upstream; this plan therefore targets exactly the requirements' success criteria and invents no accuracy target.

## Assumptions Carried Into Generation

- The classification prompt is authored during implementation; only the FR2.2 value sets are fixed, and out-of-set answers are never stored.
- No seeded corpus size is specified, so the smoke seeds a handful of synthetic items purely to give the weekly job something to cluster; nothing in the plan depends on corpus size beyond the NFR3 sanity bound.
- Ingestion stays unauthenticated, SES stays configured-but-unused, and no notification path is built.
- Production deployment, CI, monitoring and any scale or durability work stay out of scope (`poc`, NFR4 waived).
- Application code lands at the workspace root; the record dir holds only this stage's artifacts.
