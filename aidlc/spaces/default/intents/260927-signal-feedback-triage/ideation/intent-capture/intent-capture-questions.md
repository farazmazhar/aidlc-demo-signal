# Intent Capture & Framing — Questions

## Sources

- [desc] Initial description: "poc Build Signal, a customer feedback triage tool for early-stage product teams. Users submit feedback through an API or a web form. Each item is classified by an LLM for category, sentiment and urgency, and embedded for similarity. A weekly scheduled job clusters feedback into themes and writes a short summary of what changed and what needs attention. A dashboard shows themes, trends, urgent items, and lets users drill down to the raw feedback. Constraints: the system must run fully locally against an AWS-compatible emulator (endpoint http://localhost:4566) with no cloud spend. Target AWS services are API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES, with Postgres/pgvector for vectors. The LLM and embedding provider must be swappable between Ollama (local) and Amazon Bedrock by configuration only. Infrastructure must be defined as code and deployable to the emulator."
- [scope] Workflow-selected scope: `poc`.

## Q1. What problem is Build Signal solving, and why now?

The description says early-stage product teams submit feedback that gets classified, embedded, clustered into themes and surfaced on a dashboard. Intent Capture needs the concrete pain behind that pipeline, because it decides what the spike must actually demonstrate. What is failing today for these teams, and what triggered building this now?

- A. Feedback arrives through several channels (email, chat, support tickets, calls) and is lost or read only by whoever received it; themes are never aggregated, so the loudest recent complaint wins over the real pattern. Trigger: the team is about to make roadmap decisions on anecdote, not evidence.
- B. Feedback is collected in one place already, but nobody has time to read or tag it; the missing piece is automatic classification and weekly theming. Trigger: volume grew past what manual triage can absorb.
- C. There is no systematic feedback channel at all today; the product team hears from customers only in demos and renewal calls. Trigger: a new product push needs customer evidence to prioritise.
- D. Not yet defined — the pain is assumed rather than observed, and the spike is exploratory.
- X. Other (please specify)

[Answer]: C

## Q2. Who is the customer, and who else cares about this spike?

This feeds the stakeholder map, including who decides whether the spike passed. Is Build Signal a product for external early-stage teams, or tooling for one internal team (which changes who the "customer" is and what a passing spike means)?

- A. External product: the customer is a product manager or founder at an early-stage team (roughly 5-50 people); our own team dogfoods it. Decision-maker for the spike: our own tech lead.
- B. Internal tool: the customer is our own product/support team; no external users are planned for this spike.
- C. External product with a specific design partner already identified (name the team/role in Other if known).
- D. Not identified yet — the spike precedes any customer commitment.
- X. Other (please specify)

[Answer]: B

## Q3. What does "feasible" look like at the end of this spike?

Success metrics must be observable, and for a proof-of-concept they are the pass/fail test of the spike itself rather than product KPIs. Which outcome would let you say the concept works?

- A. End-to-end local demo: submit feedback via the API/web form, see it classified (category, sentiment, urgency) and embedded, have the weekly job cluster it into themes with a written summary, and see it on the dashboard with drill-down — all against the emulator with zero cloud spend.
- B. Core risk only: prove the LLM classification and embedding pipeline plus theme clustering work locally; the dashboard and delivery channels (SES) can be stubbed.
- C. Core risk only, weighted to provider swap: prove the same run works with both Ollama (local) and Bedrock configured by configuration alone, even if the clustering summary is minimal.
- D. Not yet defined — will be judged informally by whether the demo feels useful.
- X. Other (please specify)

[Answer]: A

## Q4. Does the workflow-selected `poc` boundary match what you want?

The workflow was started as `poc` (a fast feasibility spike: intent, requirements, code, test — no design, delivery-planning or operations stages). This question confirms the product boundary; it is separate from the low-level technical constraints already stated in the description (LocalStack emulator on http://localhost:4566, no cloud spend, API Gateway / Lambda / DynamoDB / EventBridge Scheduler / SES, Postgres with pgvector, infrastructure as code, swappable LLM and embedding provider).

- A. Confirm `poc`: a throwaway local feasibility spike of the whole pipeline, deliberately skipping design, delivery and operations stages. If the concept proves out, re-scope later for a real build.
- B. Narrower than `poc`: spike only the riskiest technical piece and skip the rest of the pipeline for now.
- C. Wider than `poc`: this is intended as a first real version for actual use, so it needs the design and delivery stages too — the scope should be changed.
- D. Not yet defined — the boundary will be decided after seeing the spike.
- X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

## Assumption Confirmation

- The spike's decision-maker is unidentified: the option naming our own tech lead was not selected in Q2, and no other owner was named.
- The team's existing channels (demos, renewal calls) may feed the tool manually during the spike, or entry may be only through the API and web form.
- No measurable classification quality target was set; the spike's pass/fail test is the end-to-end local demo alone.
- No communication requirement was stated: no demo audience, review cadence or reporting format for the result.

A. Accept assumptions
B. Convert to follow-up questions

[Answer]: A. Accept assumptions
