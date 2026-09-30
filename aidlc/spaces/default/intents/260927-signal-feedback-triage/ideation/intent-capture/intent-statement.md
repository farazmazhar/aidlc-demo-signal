# Intent Statement — Build Signal

## Sources

- [desc] Initial description: "poc Build Signal, a customer feedback triage tool for early-stage product teams. Users submit feedback through an API or a web form. Each item is classified by an LLM for category, sentiment and urgency, and embedded for similarity. A weekly scheduled job clusters feedback into themes and writes a short summary of what changed and what needs attention. A dashboard shows themes, trends, urgent items, and lets users drill down to the raw feedback. Constraints: the system must run fully locally against an AWS-compatible emulator (endpoint http://localhost:4566) with no cloud spend. Target AWS services are API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES, with Postgres/pgvector for vectors. The LLM and embedding provider must be swappable between Ollama (local) and Amazon Bedrock by configuration only. Infrastructure must be defined as code and deployable to the emulator."
- [scope] Workflow-selected scope: `poc`.

## Problem Statement

There is no systematic feedback channel today: the product team hears from customers only in demos and renewal calls, so feedback is never captured, classified or aggregated into themes. [Q1]

The tool being built closes that gap end to end: feedback is submitted through an API or a web form, each item is classified by an LLM for category, sentiment and urgency and embedded for similarity, a weekly scheduled job clusters the feedback into themes and writes a short summary of what changed and what needs attention, and a dashboard shows themes, trends and urgent items with drill-down to the raw feedback. [desc]

## Target Customer

- Internal tool: the customer is our own product and support team, and no external users are planned for this spike. [Q2]
- The feedback itself comes from people who use our product, submitting through the API or the web form. [desc]

## Success Metrics

The spike passes when all of the following are demonstrated locally against the emulator with zero cloud spend: [Q3] [desc]

- Feedback submitted through the API or the web form is classified for category, sentiment and urgency, and embedded. [Q3] [desc]
- The weekly scheduled job clusters the feedback into themes and writes a summary of what changed and what needs attention. [Q3] [desc]
- The dashboard shows themes, trends and urgent items, and drills down to the raw feedback. [Q3] [desc]

## Initiative Trigger

- A new product push needs customer evidence to prioritise. [Q1]

## Initial Scope Signal

- **Workflow-selected scope**: `poc` — the workflow was started as a fast feasibility spike covering intent, requirements, code and test, and skipping the design, delivery-planning and operations stages. [scope]
- **User-confirmed product boundary**: the `poc` boundary is confirmed — a throwaway local feasibility spike of the whole pipeline; if the concept proves out, re-scope later for a real build. [Q4]
- **Fixed constraints carried from the request**: run fully locally against an AWS-compatible emulator at `http://localhost:4566` with no cloud spend; target API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES, with Postgres/pgvector for vectors; define infrastructure as code deployable to the emulator; keep the LLM and embedding provider swappable between Ollama (local) and Amazon Bedrock by configuration only. [desc]

## Assumptions & Open Questions

- [assumption] Who decides that the spike passed is unanswered: Q2's option naming our own tech lead as the spike's decision-maker was not selected, and no other owner was named.
- [assumption] Whether the team's existing channels (demos, renewal calls) feed the tool manually during the spike, or entry is only through the API and web form described in the request.
- [assumption] No measurable quality target was set for classification (for example an accuracy floor); the pass/fail test is the end-to-end local demo alone. [Q3]
