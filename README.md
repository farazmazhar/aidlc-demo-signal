# Build Signal

Local, zero-cloud-spend feasibility spike. Feedback goes in through an API and a web form, an LLM
classifies it (category, sentiment, urgency), an embedding provider vectorises it, a weekly scheduled
job clusters the vectors into themes with a written summary, and a dashboard shows the themes, the
trend and the urgent items with drill-down to the raw feedback.

Everything runs on this machine: an AWS-compatible emulator at `http://localhost:4566`, Postgres with
pgvector, and Ollama. No cloud credentials are used and nothing is sent to a cloud service.

```
web form / API client ──▶ API Gateway (local) ──▶ Lambda signal-api ──▶ DynamoDB signal-feedback
                                                             └───────▶ Postgres + pgvector
                                                             └───────▶ LLM / embedding provider (Ollama | Bedrock)
EventBridge Scheduler (weekly) ──▶ Lambda signal-clustering ──▶ pgvector + DynamoDB
```

## Prerequisites

| Requirement | Why |
|---|---|
| `bun` (1.1+) and Node.js 22 | Toolchain, test runner, script runner, Lambda runtime target |
| `docker` CLI with a reachable daemon | Containers; on this machine `docker` is backed by Podman (`systemctl --user start podman.socket` if the compose provider cannot reach the socket) |
| Network access **once** | To pull the emulator, pgvector and Ollama images and the two Ollama models |
| No AWS credentials | The spike is credential-free by design (NFR5); the emulator accepts dummy credentials |

## Run order

```bash
bun install            # dependencies
bun run emulator:up    # emulator + pgvector + ollama containers, then model pulls
bun run emulator:probe # per-service capability table for the emulator
bun run db:migrate     # apply the pgvector schema rendered from configuration
bun run build          # bundle + zip both Lambda functions
bun run deploy         # CDK synth, upload artefacts, create the stack on the emulator
bun run verify:infra   # assert every mandated resource exists and is wired
bun run smoke          # end-to-end demo with the NFR2/NFR3 measurements
```

Optional:

```bash
bun run cdk:synth        # synthesise the CloudFormation template into cdk.out/ without deploying
bun run invoke:clustering# run the weekly job through the emulator's Invoke API
bun run typecheck        # tsc --noEmit
bun run lint             # eslint
bun test                 # unit suite (5 files / 15 tests)
```

## Configuration

`config/config.env` is the single source of truth and is committed — the spike holds no secrets. Host
commands load it with `bun --env-file=config/config.env`; `infra/config.ts` parses the same file to
build the Lambda environments. Container-internal endpoints differ from host endpoints, so the file
carries explicit pairs (`DATABASE_URL` / `DATABASE_URL_LAMBDA`, `OLLAMA_BASE_URL` /
`OLLAMA_BASE_URL_LAMBDA`, `AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_LAMBDA`).

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `bedrock` — which chat provider is used (FR6.1) |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` or `bedrock` — which embedding provider is used (FR6.1) |
| `OLLAMA_BASE_URL` / `OLLAMA_BASE_URL_LAMBDA` | `http://localhost:11434` / `http://ollama:11434` | Local provider endpoint for host scripts / Lambda |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | Classification and summary model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model (768 dimensions) |
| `BEDROCK_CHAT_MODEL` | `anthropic.claude-3-haiku-20240307-v1:0` | Chat model when `bedrock` is selected |
| `BEDROCK_EMBED_MODEL` | `amazon.titan-embed-text-v2:0` | Embedding model when `bedrock` is selected (1024 dimensions) |
| `AWS_REGION` | `us-east-1` | SDK region for the emulator and for Bedrock |
| `AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_LAMBDA` | `http://localhost:4566` / `http://emulator:4566` | Emulator endpoint from the host / from a Lambda container |
| `EMBEDDING_DIMENSIONS` | `768` | Vector column width; must match the embedding model |
| `FEEDBACK_TABLE` | `signal-feedback` | DynamoDB table name |
| `DATABASE_URL` / `DATABASE_URL_LAMBDA` | `postgres://signal:signal@localhost:5432/signal` / `…@postgres:5432/signal` | pgvector connection for host scripts / Lambda |
| `CLUSTER_SIMILARITY_THRESHOLD` | `0.82` | Cosine similarity at which an item joins a theme |
| `CLUSTER_MIN_SIZE` | `2` | Themes below this size are not persisted |
| `CLUSTER_WINDOW_DAYS` | `7` | Look-back window of the weekly job |
| `DASHBOARD_TREND_WEEKS` | `8` | Weeks shown in the trend view |
| `SCHEDULE_CRON` | `cron(0 6 ? * MON *)` | Weekly EventBridge Scheduler expression |
| `SES_SENDER` | `signal@example.com` | SES identity — configured, never sent through |
| `LAMBDA_RUNTIME` | `nodejs20.x` | Lambda runtime for both functions; see the limitations below |
| `API_STAGE_NAME` | `local` | API Gateway stage name |
| `LOCAL_API_URL_STYLE` | `_aws_execute_api` | Which local invoke URL form the scripts build |
| `EMULATOR_IMAGE` | `localstack/localstack:3.8.1` | Token-free emulator image |

## Provider swap (FR6.1, FR6.2)

1. Edit `config/config.env`:
   - `LLM_PROVIDER=bedrock`, `EMBEDDING_PROVIDER=bedrock`
   - set `EMBEDDING_DIMENSIONS=1024` to match `amazon.titan-embed-text-v2:0`
2. Re-run `bun run db:migrate` (the vector column width is rendered from configuration) and
   `bun run deploy`.
3. Provide AWS credentials through the normal SDK chain **only for the Bedrock path**. The local demo
   path needs none.

No application code changes: `src/providers/factory.ts` is the only place that maps a configuration
value to a vendor adapter, and `src/business/*` and `src/api/*` never mention a provider.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/feedback` | Ingest one item. Body: `{source: "api"\|"web", text, submitter_email?, product_area?}`. Unknown fields are rejected. No authentication (FR1.5) |
| `GET` | `/feedback/{id}` | Read one item |
| `GET` | `/dashboard/themes` | Current themes (of the latest run) plus the run summary |
| `GET` | `/dashboard/trends` | Per-week item and theme counts |
| `GET` | `/dashboard/urgent` | Urgent items (default urgency `high`) |
| `GET` | `/themes/{id}/items` | Drill-down: the raw items behind a theme |
| `GET` | `/health` | Liveness |
| `GET` | `/`, `/app.js`, `/styles.css` | The dashboard, served from the same origin |

Filter parameters `category`, `sentiment` and `urgency` accept only the FR2.2 values; anything else is
a `400` with the standard envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [ { "field": "category", "reason": "…" } ], "requestId": "…" } }
```

## Layout

```
src/config/        configuration loading (validated, read at call time)
src/domain/        types, the FR2.2 vocabularies, validation, ports, vector maths
src/persistence/   DynamoDB single-table adapter, pgvector adapter, in-memory fakes, schema renderer
src/providers/     LLM/embedding ports with ollama and bedrock adapters plus the factory
src/business/      enrichment, clustering, summarisation, dashboard aggregation, the weekly job
src/api/           error envelope, route table, proxy handler, static assets
src/lambda/        the two Lambda entrypoints and the composition root
infra/             CDK stack, CDK app entry and the configuration bridge
dashboard/static/  index.html, app.js, styles.css (no framework, no external asset)
db/migrations/     the canonical pgvector migration template
scripts/           emulator, probe, migrate, build, deploy, verify, invoke, smoke, zip
tests/             shared factories and provider fakes
```

## Tests

Five files, fifteen tests, `bun test` with in-memory fakes behind every port — no Docker, no emulator,
no Postgres, no Ollama, no credentials:

```bash
bun test db/schema.test.ts                     # schema rendering, config-swapped dimensions, config errors
bun test src/persistence/persistence.test.ts   # item/vector round-trip, access patterns, not-found
bun test src/business/business.test.ts         # classify + embed, provider swap, clustering, provider failures
bun test src/api/handlers.test.ts              # ingest + retrieve + dashboard routes, error envelope
bun test src/dashboard/ui.test.ts              # form payload, view models, drill-down and filter guards
```

Coverage is reported, never gated: `poc` sets no coverage floor, and no threshold is configured that
the suite would have to be weakened to meet.

## Measured results on this machine

`bun run smoke`, all 16 checks green:

| Measurement | Value | Budget |
|---|---|---|
| Classification + embedding, worst item of 7 | 1565 ms | NFR2: a few seconds |
| Weekly clustering job (8 items, includes Lambda cold start) | 7440 ms | NFR3: minutes |
| Themes persisted | 2, each with a deterministic summary | FR4.3 |
| Run summary | written by the configured chat model | FR4.2 |

## Limitations (measured, not assumed)

- **The pipeline uses the `_user_request_` URL form, not `_aws/execute-api`.** Measured on the pinned
  emulator image: `POST http://localhost:4566/_aws/execute-api/<id>/local/feedback` answers
  `200` with an empty body and never reaches the integration, while
  `http://localhost:4566/restapis/<id>/local/_user_request_/feedback` routes correctly. This is risk
  R10 materialising; `LOCAL_API_URL_STYLE` in `config/config.env` selects the form and `smoke.ts`
  prints the URL it used.
- **The Lambda runtime is `nodejs20.x`, not `nodejs22.x`.** The pinned emulator image's runtime enum
  rejects `nodejs22.x` outright (`Member must satisfy enum value set: [nodejs20.x, provided.al2023, …]`).
  `LAMBDA_RUNTIME` in `config/config.env` sets it for the stack, the probe and the bundles, so it can be
  raised on an emulator that accepts a newer runtime. Note that CDK also warns `nodejs20.x` was
  deprecated on 2026-04-30 — the pinned emulator build simply does not offer a newer value.
- **The emulator needs three services beyond the five mandated.** `compose.yaml` enables `iam` (the
  stack's roles), `s3` (Lambda artefacts) and `ssm` (the CDK `BootstrapVersion` parameter), plus `logs`
  for function output. Without `iam` the stack fails at `CreateRole`; without `ssm` it fails resolving
  the bootstrap parameter. `scripts/deploy.ts` creates `/cdk-bootstrap/hnb659fds/version` itself — that
  is the emulator's entire bootstrap step, and it leaves the synthesised template untouched.
- **The SES v2 API is not implemented by this emulator.** `AWS::SES::EmailIdentity` and
  `AWS::SES::ConfigurationSet` deploy (the stack reports them `CREATE_COMPLETE`, asserted by
  `verify:infra`), but `sesv2 GetEmailIdentity` returns "not yet implemented", and the SES v1
  `ListIdentities` store is separate from the v2 resource, so it reads back empty. The identity's
  *verification status* therefore cannot be confirmed locally; the resource's existence can.
- **Bedrock is not demonstrated live.** The emulator serves no Bedrock and the spike forbids cloud
  credentials, so FR6.1/FR6.2 are proven by configuration-driven selection tests plus the adapter's
  request/response mapping against an injected fake runtime (risk R7). The live Bedrock call is
  explicitly unverified.
- **EventBridge Scheduler is mocked by the emulator.** The schedule resource is asserted by
  `bun run verify:infra` (`cron(0 6 ? * MON *)` targeting `signal-clustering`), but the emulator never
  triggers its target, so the weekly job is invoked directly through the emulator's `Invoke` API
  (risk R2).
- **NFR4 is waived by the requirement** — no concurrency, availability or durability target exists for
  the spike. `listRuns`/`listThemes` therefore use a bounded `Scan` rather than a second index.
- **SES is configured but unused**, by requirement: no notification path is built.
