<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

- 2026-09-28T18:56:11Z — read the zero-Unit directive as stage-level work: exactly one implementation iteration, artifacts under construction/code-generation/ with no synthetic Unit segment and no Bolt, skeleton or swarm ceremony.
- 2026-09-29T00:00:00Z — read the LoadedConfig helper as a required-variable guard: DATABASE_URL has no default at all, while every other variable is defaulted but validated when present, so a present-but-unusable numeric value fails instead of falling back.
- 2026-09-29T00:00:00Z — kept ConfigError defined in src/config/config.ts and re-exported from src/domain/ports.ts, so the five domain error types have one import site without duplicating the class.
- 2026-09-29T00:00:00Z — treated the plan's `queryUrgent(limit)` as taking an optional `urgency`, because the FR2.2 urgency filter must be able to select which urgency the dashboard's urgent read uses.
- 2026-09-29T00:00:00Z — implemented theme summaries deterministically from member classifications (top category plus urgency count) and reserved the single chat call for the run-level "what changed / what needs attention" summary FR4.2 names.
- 2026-09-29T00:00:00Z — added `summary` to the dashboard view model and `run` to the dashboard API responses so the run summary FR4.2 requires is actually readable by the dashboard and by the smoke run.
- 2026-09-29T01:00:00Z — read the probe's DynamoDB failure as a bug in the probe, not an emulator gap: the probe omitted the GSI key attributes from AttributeDefinitions, so the fix was to share one attribute-definition list between the stack, the probe and the tests.
- 2026-09-29T01:00:00Z — read `AWS_REGION` being rejected as a Lambda reserved key as a signal to stop supplying it and let the runtime set it, rather than a problem to work around.
- 2026-09-29T01:00:00Z — treated the emulator's unimplemented `sesv2` API as a capability gap to report, not as a reason to swap in a different resource: `verify:infra` asserts the deployed `AWS::SES::EmailIdentity` from the stack's own resource list and prints the gap.
- 2026-09-29T01:00:00Z — read the empty-200 from `_aws/execute-api` as the R10 URL-style risk materialising rather than a routing bug in our stack, and selected the working form through configuration.
- 2026-09-28T20:59:25Z — read the reporter's "barebones dashboard" as a path-prefix bug, not a styling complaint: index.html referenced /styles.css and /app.js absolutely and app.js fetched /dashboard/* and /feedback absolutely, while the page is served under /restapis/<apiId>/<local>/_user_request_/ — every one of those requests 404s at the origin root.
## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

- 2026-09-28T18:56:11Z — added two steps beyond the Testing Contract ordering baseline (IaC plus emulator deployment, then the end-to-end smoke), because FR7.1 and NFR1–NFR3 are only observable once the stack exists on the emulator; every baseline step is otherwise preserved in order.
- 2026-09-29T00:00:00Z — `@aws-sdk/client-apigateway` in the plan's dependency list is not a published package; installed `@aws-sdk/client-api-gateway` instead.
- 2026-09-29T00:00:00Z — added `AWS_ENDPOINT_URL_LAMBDA=http://emulator:4566` to config/config.env, because a Lambda container cannot reach the host's `localhost:4566` and the plan's variable table had no container-side emulator endpoint.
- 2026-09-29T00:00:00Z — Lambda `Code` is an explicit S3 bucket/key instead of a CDK asset: `cdk-assets` publishing needs a bootstrapped AWS account, so scripts/deploy.ts uploads the two zips to the emulator's S3 and the stack points at them.
- 2026-09-29T00:00:00Z — `cdk synth` runs through `infra/lib/signal-app.ts` rather than the CDK CLI, because no `cdk` binary exists on this machine; `bun run cdk:synth` still writes cdk.out/.
- 2026-09-29T00:00:00Z — added `scripts/zip.ts` (a small dependency-free ZIP writer) because no `zip` binary is guaranteed here and the Lambda code payloads must be real archives.
- 2026-09-29T00:00:00Z — added one unplanned module, `src/domain/vector-math.ts`, so the clustering algorithm and the in-memory vector fake share exactly one cosine implementation.
- 2026-09-29T00:00:00Z — `scripts/emulator-up.sh` starts the Podman user socket when the daemon is unreachable; the machine's `docker` shim works but its compose provider needs that socket running.
- 2026-09-29T01:00:00Z — switched `LAMBDA_RUNTIME` to `nodejs20.x` for the deploy: the pinned emulator image's runtime enum rejects `nodejs22.x`, and the value is now configuration so it can be raised on a newer emulator.
- 2026-09-29T01:00:00Z — set `LOCAL_API_URL_STYLE=_user_request_` after measuring that this build returns an empty 200 for the `_aws/execute-api` form and routes the `/restapis/<id>/<stage>/_user_request_/` form correctly.
- 2026-09-29T01:00:00Z — added `iam`, `logs`, `s3` and `ssm` to the emulator's `SERVICES` list: without `iam` the stack fails at `CreateRole` and without `ssm` it cannot resolve CDK's `BootstrapVersion` parameter.
- 2026-09-29T01:00:00Z — `scripts/deploy.ts` creates `/cdk-bootstrap/hnb659fds/version`, which is the emulator's whole CDK bootstrap step; the synthesised template is deployed unedited.
- 2026-09-29T01:00:00Z — `verify:infra` asserts the SES identity and configuration set from the stack's resource list, because the emulator implements no `sesv2` read API and its SES v1 identity store is separate from the CFN resource.
- 2026-09-29T01:00:00Z — added `@aws-sdk/client-ssm` for that bootstrap parameter; a `@aws-sdk/client-sesv2` probe was tried and removed once sesv2 proved unimplemented, so no unused dependency remains.
- 2026-09-28T20:59:25Z — after the review receipt, changed three reviewed-output paths (dashboard/static/index.html, dashboard/static/app.js, src/dashboard/ui.test.ts) to relative './' asset and API paths, because the human reported the dashboard rendered no data; re-ran the five unit commands (15 pass), typecheck, lint, build and deploy, and verified in Chromium that the panels populate with no console errors.
## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

- 2026-09-28T18:56:11Z — chose TypeScript on the Lambda Node runtime with CDK-synthesised CloudFormation deployed through AWS SDK v3 scripts, since this machine has no aws, sam, terraform, awslocal, tflocal or cdklocal CLI, so the deploy path had to run from npm dependencies alone.
- 2026-09-28T18:56:11Z — chose `bun test` with in-memory fakes behind ports so all 15 unit tests run with no Docker, no emulator, no Postgres and no credentials.
- 2026-09-28T18:56:11Z — preferred a token-free emulator on http://localhost:4566 over LocalStack, whose docs show an auth token requirement and a plan-gated, mock-only EventBridge Scheduler.
- 2026-09-29T00:00:00Z — chose `bun test` with in-memory adapters so the whole unit scope runs with no Docker, emulator, Postgres or credentials, as the unit-test instructions require.
- 2026-09-29T00:00:00Z — made the dashboard bundle's FR2.2 filter values a mirrored constant cross-checked against src/domain/types.ts by T14, because a browser module cannot import from src/.
- 2026-09-29T00:00:00Z — kept `listRuns`/`listThemes` as bounded `Scan` calls: the approved single-table key design gives each run and theme its own partition, DynamoDB cannot Query across partitions, and NFR4 waives scale.
- 2026-09-29T00:00:00Z — left the AWS SDK external in the Lambda bundles (the nodejs22.x runtime provides it) and bundled only `pg`, `zod` and application code, which keeps api.zip at ~75 KB.
- 2026-09-29T01:00:00Z — chose the `_user_request_` invoke URL form over the `_aws/execute-api` form on measured behaviour rather than documentation, keeping the style configurable so a different emulator build can use another form.
- 2026-09-29T01:00:00Z — built the emulator probe from the same shared key/attribute definitions as the CDK stack, so a probe that passes cannot disagree with the table the stack creates.
- 2026-09-29T01:00:00Z — accepted the CDK `nodejs20.x` deprecation warning rather than shipping a runtime the emulator cannot create, and recorded the warning as an outstanding item.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->

- 2026-09-28T18:56:11Z — which emulator build answers at http://localhost:4566 here is unresolved until the capability probe runs; the demo path depends on it.
- 2026-09-28T18:56:11Z — Ollama model choice versus the NFR2 latency budget on this CPU-only machine is unmeasured; defaults are small and every model id is configurable.
- 2026-09-28T18:56:11Z — whether a human would accept an authenticated emulator if a token-free one cannot provide a mandated service is not yet decided.
- 2026-09-29T00:00:00Z — whether the local emulator build answers the scheduler, SES and CloudFormation calls the probe makes is still unverified until `bun run emulator:probe` runs against the running containers.
- 2026-09-29T00:00:00Z — measured NFR2 per-item latency and NFR3 job duration for the CPU-only Ollama path are still unmeasured; the smoke run records them.
- 2026-09-29T01:00:00Z — measured, not assumed: NFR2 worst per-item classify+embed latency 1565 ms and the NFR3 job 7440 ms, both far inside their budgets on this CPU-only machine with `llama3.2:3b` and `nomic-embed-text`.
- 2026-09-29T01:00:00Z — whether a newer emulator image would accept `nodejs22.x` and route `_aws/execute-api` is untested; both are configuration values now, not code.
- 2026-09-29T01:00:00Z — the SES identity's verification status cannot be confirmed on this emulator build; only the deployed resource's existence can.
