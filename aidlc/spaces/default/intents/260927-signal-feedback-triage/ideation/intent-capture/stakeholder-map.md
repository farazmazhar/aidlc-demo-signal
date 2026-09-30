# Stakeholder Map — Build Signal

## Sources

- [desc] Initial description: "poc Build Signal, a customer feedback triage tool for early-stage product teams. Users submit feedback through an API or a web form. Each item is classified by an LLM for category, sentiment and urgency, and embedded for similarity. A weekly scheduled job clusters feedback into themes and writes a short summary of what changed and what needs attention. A dashboard shows themes, trends, urgent items, and lets users drill down to the raw feedback. Constraints: the system must run fully locally against an AWS-compatible emulator (endpoint http://localhost:4566) with no cloud spend. Target AWS services are API Gateway, Lambda, DynamoDB, EventBridge Scheduler and SES, with Postgres/pgvector for vectors. The LLM and embedding provider must be swappable between Ollama (local) and Amazon Bedrock by configuration only. Infrastructure must be defined as code and deployable to the emulator."
- [scope] Workflow-selected scope: `poc`.

## Key Stakeholders

| Stakeholder | Interest | Role | Source |
|---|---|---|---|
| Our product and support team | Gets customer feedback triaged automatically instead of hearing from customers only in demos and renewal calls | Primary customer and user of the tool | [Q1] [Q2] |
| People who submit feedback about our product | Their feedback is captured through the API or the web form and ends up on the dashboard with drill-down to the raw item | Source of the feedback data | [desc] |
| The engineer building the spike | Keeps the run local against the emulator at zero cloud spend, with the LLM and embedding provider swappable by configuration | Implementer | [desc] |

## Decision-Makers vs. Influencers

- **Decision-maker**: Unknown (open question) [assumption] — the request names no one who decides whether the spike passed or who sets its priority; Q2's option naming our own tech lead as the spike's decision-maker was not selected.
- **Influencer**: our product and support team, as the tool's customer, shapes what triage has to produce. [Q2]
- **Influencer**: the engineer implementing the spike, whose local-only, zero-cloud-spend and swappable-provider constraints bound what it may do. [desc]

## Communication Requirements

| Requirement | Detail | Source |
|---|---|---|
| Unknown (open question) [assumption] | No reporting cadence or communication requirement was stated for this spike. | [assumption] |

## Assumptions & Open Questions

- [assumption] The spike's decision-maker is unidentified, so nothing yet names who accepts it as passed.
- [assumption] No communication requirement was stated: no demo audience, review cadence or reporting format for the spike's result.
