# Practitioner review packet

Send this to loan-operations, agency or credit-fund practitioners. It takes 15 minutes. Answers are recorded in [validation.md §3](validation.md#3-practitioner-review-open) by role and date, never by name.

## What to look at (10 minutes)

1. [PITCH.md](../PITCH.md), two minutes.
2. The five-minute demo flow in the [README](../README.md) (a recorded walkthrough will be linked there once available; the flow and every receipt are readable without it).
3. One HashScan receipt of your choice from the README's settlement evidence, to see that the trade and the failed trade are real.
4. The reconciliation report an agent would receive: run `npm run agent:reconcile` or read `ops/reports/`.

## Structured questions (5 minutes)

Score 1 (strongly disagree) to 5 (strongly agree), then one line of why.

| # | Statement | Score | Why |
|---|---|---|---|
| Q1 | The RFQ, approval and settlement sequence matches how a desk actually trades a loan interest. | | |
| Q2 | Re-checking eligibility at execution, with a full revert on revocation, is the right behaviour. | | |
| Q3 | A 2-of-3 named-member approval on the desk wallet reflects real internal control (trader, compliance, PM). | | |
| Q4 | Keeping the rate notice off-ledger and publishing only a commitment is acceptable to an agent. | | |
| Q5 | The shadow-register reconciliation report is something my operations team could act on daily. | | |
| Q6 | The assignment export could be processed in our loan system without re-keying. | | |
| Q7 | I would take part in a one-quarter shadow-register pilot on one facility. | | |

## Open design questions (pick any)

From [HACKATHON-PRD.md §11](../HACKATHON-PRD.md#11-risks-and-open-questions):

- Which party should be authorised to create and cancel a settlement instruction?
- At what point should borrower and agent consent become final?
- Is T+1 a meaningful target, or should the product settle immediately once all conditions are met?
- Should the register represent assignments, participations or both?
- What evidence must an agent retain outside the ledger for a legally effective transfer?

## How the answer is recorded

```
| Reviewer role | Date | Observation | Evidence | Decision | Change |
| Loan operations, private-sector bank (India) | 2026-09-14 | Q2: wants consent state visible before scheduling | Review form on file with founder | Add consent flag to instruction | Backlog item, PRD §11 |
```

## Outreach message (edit before sending)

> Subject: 15 minutes on loan settlement on a shared register
>
> I have built a working prototype that settles a syndicated-loan assignment and its cash leg as one transaction, with eligibility re-checked at execution and the agent's rate notice kept private. It runs end to end on Hedera testnet. I would value 15 minutes of your reaction as someone who runs this process today. The packet is one page and seven scored questions. I record answers by role only. If useful, I can also show what a one-quarter shadow-register pilot on a single facility would involve for your team, which is a register export and about two hours a week.
