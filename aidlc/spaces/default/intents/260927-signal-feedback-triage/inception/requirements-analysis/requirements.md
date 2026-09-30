# Requirements — Build Signal

Scope: `poc` (throwaway local feasibility spike). Upstream: `ideation/intent-capture/intent-statement.md`.

## Intent Analysis

Prove, fully locally and at zero cloud spend, that customer feedback can be captured, classified by an LLM, embedded, clustered into weekly themes with a written summary, and surfaced on a dashboard with drill-down to the raw items. [desc] [Q1] [Q3]

The tool is internal: our own product and support team is the customer, and no external users are planned for this spike. [Q2] [Q4]

## Functional Requirements

### FR1 — Feedback ingestion

- FR1.1 The system shall accept a POST of a feedback item as JSON from an API endpoint, with `source` (`api` or `web`), `text`, an optional `submitter_email`, and an optional `product_area`. [desc] [Q2]
- FR1.2 The system shall accept the same payload shape from a web form, so both entry points produce identical items. [desc] [Q2]
- FR1.3 The system shall assign a server-side timestamp to each accepted item. [Q2]
- FR1.4 The system shall persist each item and allow it to be retrieved by its identifier. [desc] [Q2]
- FR1.5 Ingestion shall be unauthenticated for the spike. [Q2]

### FR2 — Classification

- FR2.1 The system shall classify each item for category, sentiment and urgency using the configured LLM provider. [desc] [Q1]
- FR2.2 Category shall be one of {bug, feature request, usability, performance, pricing, other}; sentiment one of {positive, neutral, negative}; urgency one of {low, medium, high}. [Q1]
- FR2.3 The three values shall be stored as strings and used verbatim as the dashboard's filter values, with no free-form categories or urgency labels. [Q1]

### FR3 — Embedding

- FR3.1 The system shall embed each item through the configured embedding provider and store the resulting vector for similarity use. [desc] [Q1]
- FR3.2 Stored vectors shall be associated with the item they were produced from. [desc]

### FR4 — Weekly theme clustering and summary

- FR4.1 A scheduled job shall run weekly, triggered by EventBridge Scheduler, to cluster stored feedback into themes by embedding similarity. [desc]
- FR4.2 The job shall write a short summary of what changed and what needs attention. [desc]
- FR4.3 Themes and their summaries shall be persisted for the dashboard. [desc]

### FR5 — Dashboard

- FR5.1 The dashboard shall show themes, trends and urgent items. [desc]
- FR5.2 The dashboard shall let a user drill down from a theme, trend or urgent item to the raw feedback items behind it. [desc]
- FR5.3 Dashboard filtering shall use the classification values from FR2.2. [Q1]

### FR6 — Provider swap by configuration

- FR6.1 The LLM and embedding provider shall be selectable between Ollama (local) and Amazon Bedrock by configuration alone, with no code change. [desc]
- FR6.2 Each provider setting shall be read from configuration at run time, so the same deployment can be switched between the two. [desc]

### FR7 — Infrastructure as code

- FR7.1 Target AWS services — API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES — shall be defined as code and deployable to the local emulator at `http://localhost:4566`. [desc]
- FR7.2 Postgres with pgvector shall be provisioned for vector storage, and its connection details shall come from configuration. [desc]

## Non-Functional Requirements

- NFR1 The whole system shall run locally against the AWS-compatible emulator at `http://localhost:4566`, with no cloud spend. [desc] [Q4]
- NFR2 Classification plus embedding of a single item shall complete within a few seconds when running against the local provider. [Q4]
- NFR3 The weekly clustering job shall complete in minutes for a few hundred items. [Q4]
- NFR4 No concurrency, availability or durability targets apply to the spike; these are explicitly waived rather than unmet. [Q4]
- NFR5 The end-to-end demo shall be reproducible locally with no cloud credentials and no network dependency beyond the local emulator and the configured local provider. [desc] [Q4]

## Constraints

- Local AWS emulator endpoint is `http://localhost:4566`; no cloud spend is permitted. [desc]
- Target AWS services are API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES. [desc]
- Vector storage is Postgres with pgvector. [desc]
- The LLM and embedding provider must be swappable by configuration only. [desc]
- Infrastructure must be defined as code and deployable to the emulator. [desc]
- Scope is `poc`: no design, delivery-planning or operations stages, and the spike is throwaway. [scope] [Q4]
- Ingestion carries no authentication. [Q2]
- SES sends nothing during the spike. [Q3]

## Assumptions

- The spike's decision-maker is unidentified; nobody is named as accepting it as passed (carried from Intent Capture, accepted there).
- Whether the team's existing channels (demos, renewal calls) feed the tool manually during the spike is unresolved; the API and web form are the only specified entry points.
- No classification accuracy target is set: the pass/fail test is the end-to-end local demo alone.
- The classification prompt is authored during implementation; only the value sets in FR2.2 are fixed here.

## Out of Scope

- Email or any other notification delivery: SES is configured but unused during the spike. [Q3]
- Authentication and authorization on ingestion, and any user accounts on the dashboard. [Q2]
- Product/plan segmentation fields (`product_version`, `plan_tier`) and client-supplied timestamps. [Q2]
- Production deployment, CI/CD pipelines, monitoring and alerting stacks.
- Any accuracy, availability or scale guarantee beyond NFR2–NFR5. [Q4]

## Open Questions

- Who accepts the spike as passed, and against what threshold beyond NFR5, remains open.
- Whether a seeded corpus of a stated size is required for the demo (Q4's option B was not selected).
