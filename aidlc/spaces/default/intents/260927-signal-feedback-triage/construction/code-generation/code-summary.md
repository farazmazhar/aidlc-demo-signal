# Code Summary — code-generation, zero-Unit target

Stage target `AIDLC-STAGE: code-generation`; intent `260927-signal-feedback-triage`; scope `poc`;
depth Minimal; test strategy Minimal; project type Greenfield. No `directive.unit` and no Unit DAG, so
one implementation iteration covers the whole stage with no synthetic Unit segment.

Testing Contract `sha256:be5041ec2297dded1a31f328fae6a86555cf649f231018ea8168c9bb8dd811a5` was followed
as written: **test-after**, one implement/run pair per applicable testable layer, runner bootstrapped
before the first test, all 15 tests written in this dispatch.

## Files created

Application code, tests, IaC, scripts, dashboard assets and configuration all live at the workspace
root (`signal-demo/`); the `aidlc/` record tree holds only this stage's artifacts.

| Area | Files |
|---|---|
| Project skeleton | `package.json`, `tsconfig.json`, `tsconfig.build.json`, `bunfig.toml`, `eslint.config.js`, `.gitignore`, `README.md`, `compose.yaml` |
| Configuration | `config/config.env`, `src/config/config.ts`, `infra/config.ts` |
| Domain | `src/domain/types.ts`, `src/domain/ports.ts`, `src/domain/validation.ts`, `src/domain/vector-math.ts` |
| Persistence | `src/persistence/dynamo-keys.ts`, `dynamo-repository.ts`, `pg-schema.ts`, `pgvector-store.ts`, `in-memory.ts`, `db/migrations/001_init.sql` |
| Providers | `src/providers/types.ts`, `ollama.ts`, `bedrock.ts`, `factory.ts` |
| Business logic | `src/business/enrichment.ts`, `clustering.ts`, `summarise.ts`, `dashboard.ts`, `job.ts` |
| API | `src/api/errors.ts`, `request-body.ts`, `static-assets.ts`, `routes.ts`, `handler.ts` |
| Lambda | `src/lambda/dependencies.ts`, `api-lambda.ts`, `clustering-lambda.ts` |
| Dashboard | `dashboard/static/index.html`, `app.js`, `styles.css` |
| IaC | `infra/lib/signal-stack.ts`, `infra/lib/signal-app.ts`, `infra/bin/app.ts` |
| Scripts | `scripts/emulator-up.sh`, `emulator-probe.ts`, `db-migrate.ts`, `build-lambda.ts`, `zip.ts`, `deploy.ts`, `verify-infra.ts`, `invoke-clustering.ts`, `smoke.ts` |
| Tests | `tests/factories.ts`, `tests/fakes.ts`, `db/schema.test.ts`, `src/persistence/persistence.test.ts`, `src/business/business.test.ts`, `src/api/handlers.test.ts`, `src/dashboard/ui.test.ts` |

Generated (not committed; `.gitignore`d): `build/`, `cdk.out/`, `.signal-stack.json`.

## Key implementation decisions

- **Provider swap is one function.** `src/providers/factory.ts` is the only place mapping a
  configuration value to a vendor adapter; `src/business/*` and `src/api/*` never name a provider.
  `loadConfig` validates the enum, so an unknown provider fails before anything runs (FR6.1, FR6.2).
- **Configuration is read at call time.** `loadConfig(process.env)` runs per invocation; there is no
  module-level `process.env` capture anywhere. Numeric variables are validated when present, so a
  present-but-unusable value fails loudly instead of falling back to a default.
- **One shared table definition.** `GSI_DEFINITIONS` and `TABLE_ATTRIBUTE_DEFINITIONS` in
  `src/persistence/dynamo-keys.ts` are consumed by the CDK stack, the emulator probe and the unit
  tests, so the deployed table cannot drift from the code. `listRuns`/`listThemes` use a bounded
  `Scan` because the approved key design gives each run and theme its own partition and NFR4 waives
  scale.
- **Classification never stores a free-form value.** `parseClassificationAnswer` normalises case and
  whitespace, then requires exact membership in the FR2.2 vocabularies; an unusable answer gets
  exactly one repair prompt that quotes the rejection, and then the call fails with
  `ProviderOutputError` (FR2.2, FR2.3).
- **Two timestamp-bearing responsibilities, one clock.** The injected `Clock` supplies the single
  server-side timestamp used as an item's `createdAt` (FR1.3), and tests always pass `fixedClock`.
- **Run summary is readable by the dashboard.** `DashboardView.run` carries the latest weekly run, and
  `/dashboard/themes|trends|urgent` return it, so FR4.2's written summary is surfaced rather than
  stored and forgotten.
- **Filter values are proven equal, not assumed equal.** The browser bundle cannot import from `src/`,
  so T14 asserts the bundle's filter lists against `CATEGORIES`/`SENTIMENTS`/`URGENCIES` — drift fails
  the test.
- **Emulator deploy has no CDK assets and no CDK CLI.** `scripts/deploy.ts` synthesises in-process,
  creates the one CDK bootstrap SSM parameter, uploads the zips to emulator S3, then `CreateStack`s the
  template with the Lambda `Code` as literal bucket/key.
- **Every integration boundary is typed.** Ollama/HTTP, Bedrock `InvokeModel`, DynamoDB, Postgres and
  the API all raise `ProviderError`, `ProviderOutputError`, `NotFoundError`, `ValidationError` or
  `ConfigError`, and the API maps them to 400/404/502/500 with the documented envelope. Unhandled
  errors are logged before answering 500 — never swallowed.

## Test results (exact commands)

### Unit scope — the five planned commands

| Command | Result |
|---|---|
| `bun test db/schema.test.ts` | 3 pass / 0 fail, 42 expect() calls |
| `bun test src/persistence/persistence.test.ts` | 3 pass / 0 fail, 32 expect() calls |
| `bun test src/business/business.test.ts` | 3 pass / 0 fail, 41 expect() calls |
| `bun test src/api/handlers.test.ts` | 3 pass / 0 fail, 58 expect() calls |
| `bun test src/dashboard/ui.test.ts` | 3 pass / 0 fail, 27 expect() calls |

**15 tests across 5 files, 200 expect() calls, 0 failures.** No Docker, no emulator, no Postgres, no
Ollama, no credentials, no network — every external boundary is a fake behind a port.

### Static checks

| Command | Result |
|---|---|
| `bun run typecheck` | clean (`tsc --noEmit`, strict, `NodeNext`, `noUncheckedIndexedAccess`) |
| `bun run lint` | clean (`eslint .`, flat config + typescript-eslint) |

No quality target was relaxed, lowered or disabled to make a step pass. `poc` sets no coverage floor,
so no coverage threshold exists to weaken; coverage is reported only, per the unit-test instructions.

### Emulator-level commands

| Command | Result |
|---|---|
| `bun run emulator:up` | Three containers up: `localstack/localstack:3.8.1` (`:4566`), `pgvector/pgvector:pg16` (`:5432`, alias `postgres`), `ollama/ollama:latest` (`:11434`, alias `ollama`). Images pulled (~3.6 GB Ollama image) and both models pulled into the Ollama container (`llama3.2:3b`, `nomic-embed-text`). |
| `bun run emulator:probe` | Every mandated service answered: dynamodb (table + 3 GSIs), apigateway, lambda, scheduler, ses, plus s3 and cloudformation. `bedrock` recorded as a gap — no local endpoint, and the spike forbids cloud credentials (risk R7). |
| `bun run db:migrate` | 4 statements applied; verified `extension:vector = 0.8.6`, `feedback_vectors.embedding = vector(768)`, `feedback_vectors_embedding_idx` using `hnsw (embedding vector_cosine_ops)`, `feedback_vectors_created_at_idx` using btree. |
| `bun run build` | `build/api.zip` 75,321 bytes (`index.js` + 3 static files), `build/clustering.zip` 46,078 bytes; both bundles load under Node and export a handler. |
| `bun run deploy` | Stack `signal-stack` reached `CREATE_COMPLETE`; outputs: REST API `d5e1jffnf1`, stage `local`, functions `signal-api` / `signal-clustering`, table `signal-feedback`, schedule `signal-weekly-clustering`, artefact bucket `signal-artifacts`, written to `.signal-stack.json`. |
| `bun run verify:infra` | **9/9 PASS**: stack `CREATE_COMPLETE`; table `ACTIVE` with `[gsi_category_created, gsi_theme_created, gsi_urgency_created]`; both functions `Active`; REST API with the `{proxy+}` resource and a root proxy method; stage `local`; schedule `cron(0 6 ? * MON *)` targeting the clustering function; SES identity and configuration set `CREATE_COMPLETE`. |
| `bun run smoke` | **16/16 PASS** — see the measurements below. |

## NFR2 / NFR3 measurements (from `bun run smoke`)

| Measurement | Run 1 | Run 2 (final) | Budget | Verdict |
|---|---|---|---|---|
| Classification + embedding, worst item of 7 (NFR2) | 1565 ms | 1624 ms | a few seconds (asserted 10 s) | pass |
| Weekly clustering job, including Lambda cold start (NFR3) | 7440 ms (8 items) | 5328 ms (15 items) | minutes (asserted 120 s) | pass |
| Unit-level NFR3 sanity: 300 vectors / 100 themes | 5 ms | 5 ms | job sanity bound (asserted 10 s) | pass |
| Items ingested through the emulated API Gateway | 7, all 201 with server timestamps and FR2.2 values | 7, likewise | — | pass |
| Themes persisted with summaries | 2 | 2 | ≥1 | pass |
| Run summary | written by `llama3.2:3b` through the configured provider | likewise | FR4.2 | pass |

The second run is the final transcript, taken after the last code change; the item count grew from 8
to 15 because the emulator's DynamoDB persists between runs and each smoke seeds six more items.

NFR1 and NFR5 were asserted directly by the smoke environment checks: no `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` or `AWS_PROFILE` in the environment, and the emulator,
Postgres and Ollama endpoints all resolving to local hosts with the emulator on port 4566. **NFR4 is
waived by the requirement**: no concurrency, availability or durability target exists, so no test was
invented for it, and the two `Scan`-based reads that follow from the approved key design are recorded
as a spike tradeoff rather than a hidden gap.

## Deviations from the approved plan

Nothing below changes what the requirements demand; each is either a measured environment fact or a
smaller implementation of a plan bullet, and each is visible in code comments and in the stage diary.

1. **`@aws-sdk/client-apigateway` is not a published package.** Installed `@aws-sdk/client-api-gateway`.
2. **Lambda runtime is `nodejs20.x`, not `nodejs22.x`.** The pinned emulator image's runtime enum
   rejects `nodejs22.x` (`Member must satisfy enum value set: [nodejs20.x, provided.al2023, …]`).
   `LAMBDA_RUNTIME` in `config/config.env` drives the stack, the probe and the bundle target, so it can
   be raised when the emulator accepts a newer runtime. CDK also warns `nodejs20.x` was deprecated on
   2026-04-30, which is recorded here as an outstanding maintenance item rather than hidden.
3. **Local API URL style is `_user_request_`.** Measured: `_aws/execute-api/<id>/<stage>/…` answers
   `200` with an empty body on this build and never routes to the integration, while
   `/restapis/<id>/<stage>/_user_request_/…` routes correctly (risk R10). The style stays
   configuration-driven and `smoke.ts` prints the URL it used.
4. **Three emulator services beyond the five mandated.** `compose.yaml` also enables `iam`, `s3`, `ssm`
   and `logs`. Without `iam` the stack fails at `CreateRole`; without `ssm` it fails resolving CDK's
   `BootstrapVersion` parameter. `scripts/deploy.ts` creates `/cdk-bootstrap/hnb659fds/version` — the
   emulator's entire bootstrap step, leaving the synthesised template unedited.
5. **SES is verified from the stack's resource list.** The emulator implements no `sesv2` API, and the
   SES v1 `ListIdentities` store is separate from the CFN `AWS::SES::EmailIdentity` resource, so the
   identity's verification status cannot be read back locally. `verify:infra` asserts the deployed
   resource instead and prints the gap; it does **not** substitute a different resource.
6. **Lambda `Code` is an explicit S3 bucket/key, not a CDK asset**, because `cdk-assets` publishing
   needs a bootstrapped AWS account the spike cannot have; `deploy.ts` uploads the zips.
7. **`cdk synth` runs programmatically** via `infra/lib/signal-app.ts` (shared with `deploy.ts`)
   because no `cdk` CLI exists on this machine; `bun run cdk:synth` still writes `cdk.out/`.
8. **`scripts/zip.ts` was added** — no `zip` binary is guaranteed here and the Lambda payloads must be
   real archives.
9. **`src/domain/vector-math.ts` was added** so the clustering algorithm and the in-memory vector fake
   share exactly one cosine implementation.
10. **`AWS_ENDPOINT_URL_LAMBDA=http://emulator:4566` was added to `config/config.env`**: a Lambda
    container cannot reach the host's `localhost:4566`, and the plan's variable table had no
    container-side emulator endpoint.
11. **`queryUrgent(limit, urgency?)` gained the optional parameter** so the FR2.2 urgency filter can
    select which urgency the dashboard's urgent read uses.
12. **The dashboard surfaces the run summary**: `DashboardView.run` and the `run` field on the three
    dashboard responses, plus `summary` in the dashboard view model — FR4.2 requires the written
    summary to be observable and no plan bullet named a read path for it.
13. **`emulator-up.sh` starts the Podman user socket and discovers `DOCKER_SOCKET`** — this machine's
    `docker` shim works but its compose provider needs the rootless socket, which was not running.
14. **`@aws-sdk/client-ssm` was added** (dependency) for that one bootstrap parameter; a
    `@aws-sdk/client-sesv2` probe was tried during verification and removed again once sesv2 proved
    unimplemented, so no unused dependency remains.
15. **T1, T8 and T14 were extended in place** (attribute-definition coverage, clustering determinism,
    run summary) rather than adding files or tests: the counts stay at the planned 5 files / 15 tests.

## Traceability

`traceability.json` maps every FR (FR1.1–FR1.5, FR2.1–FR2.3, FR3.1–FR3.2, FR4.1–FR4.3, FR5.1–FR5.3,
FR6.1–FR6.2, FR7.1–FR7.2) and every observable NFR (NFR1, NFR2, NFR3, NFR5) to an existing
implementation or test file; NFR4 is recorded as `N/A` with the requirement's own waiver as its
justification. `source-manifest.json` lists every application path this stage created.

## Post-review fix — dashboard asset and API paths (2026-09-28T20:59:25Z)

Reported by the human: the dashboard rendered with no data ("Loading…" persists) and no styling.

Root cause: `dashboard/static/index.html` referenced `/styles.css` and `/app.js` with origin-root
paths, and `dashboard/static/app.js` fetched `/dashboard/themes`, `/dashboard/trends`,
`/dashboard/urgent`, `/feedback` and `/themes/<built-in function id>/items` the same way. The page is served under
`http://localhost:4566/restapis/<apiId>/<stage>/_user_request_/`, so every one of those requests
hit `http://localhost:4566/...` and returned 404 (verified: `/app.js`, `/styles.css` and
`/dashboard/themes` at the origin root all 404).

Fix: all asset references and request paths are now relative to the page (`./styles.css`,
`./app.js`, `./dashboard/themes`, `./dashboard/trends`, `./dashboard/urgent`, `./feedback`,
`./themes/<built-in function id>/items`). Opening the dashboard without the trailing slash is not supported — the
emulator answers that form with HTTP 500, so the broken-relative-base case cannot occur.

Files changed after the review receipt: `dashboard/static/index.html`, `dashboard/static/app.js`,
`src/dashboard/ui.test.ts` (three path expectations updated). No new files, so
`source-manifest.json` and `traceability.json` are unchanged.

Re-verification: `bun test` — 15 pass / 0 fail across the five files; `bun run typecheck` and
`bun run lint` clean; `bun run build` + `bun run deploy` re-deployed the stack; a real Chromium
tab against the deployed URL now renders the weekly summary text, the theme list with drill-down
buttons, the populated filter selects and the stylesheet (heading computed font resolved), with no
console or page errors.
