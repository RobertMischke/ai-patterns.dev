# Workflow-Sized Tasks

*Draft — pattern P-49. Status: Assess.*

## Problem

A large agent task can be represented in two very different ways:

1. one card whose runtime plans, delegates and synthesizes several slices; or
2. several coherent cards connected by explicit dependencies.

The first shape looks economical because the outer pipeline claims once, creates one
worktree, performs one final review and gate, and records one merge. The second looks
safer because every slice receives its own acceptance contract, evidence and retry
history. Neither intuition is sufficient. A workflow starts workers with their own
context and model work, while a chain of cards repeats setup and review. One workflow
also turns a local failure into a combined retry and can make a large diff difficult
to attribute or review.

The decision is therefore not “big or small?” in isolation. It is whether a specific
body of work, provider route and validation strategy earns a larger unit of failure,
review and accountability.

## Forces

### Token cost versus pipeline ceremony

The accepted TE-23 analysis measured a strong asymmetry in Agent Studio's historical
pipeline corpus: coding runs carried 98.1% of recorded tokens, while four review
aspects carried about 1.9%. Deterministic test, git and lint steps recorded no model
tokens. Test gates still consumed 4,949 minutes, 16.6% of measured compute, so their
repetition affects latency and throughput; it is not a comparable model-token cost.

For `k` small cards, a simplified model is:

```text
Tokens_small = sum over cards and attempts of
                 (repeated setup + coding + outer review)
```

For one workflow-sized card:

```text
Tokens_big = sum over outer attempts of
               (parent setup + parent coding + workflow planning
                + worker work + synthesis + outer review)
```

The larger card is token-cheaper only when avoided repeated coding context, reviews
and retries exceed planning, duplicated worker context, synthesis and extra tokens
caused by a combined retry. Saving claim and merge mechanics alone is not a token
argument. The 98.1% and 1.9% figures are observational ratios, not constants to plug
into a new task estimate.

### Shared context versus failure isolation

A workflow runtime can carry intermediate values through branches and loops without
stuffing every result into the parent conversation. That is useful for independent
audits, path-local migrations and competing read-only investigations. Yet a failed
outer gate can reopen the entire task. Small cards make completed dependencies
durable and retry only the failed slice.

### Parallelism versus coordination

Parallel workers pay when they own independent questions or disjoint paths. They
lose when they negotiate a changing interface or write overlapping files. A
workflow does not make concurrent shared writes conflict-free. Explicit
dependencies serialize the places where one slice defines an API, schema, migration
or decision needed by the next.

### Throughput versus steering and attribution

One workflow removes operator decisions between slices and produces one outer task
ledger. Small cards create natural go/no-go, reprioritization and cancellation
points. They also tie a review finding, retry and merge to a bounded outcome rather
than to one combined change.

### Desired orchestration versus available capability

Claude Code and Codex expose different primitives in the supplied evidence:

| Route | Documented capability | Boundary for this pattern |
|---|---|---|
| Claude Code | Scripted workflows whose runtime owns control flow and intermediate results, plus ordinary subagents. Individual agents can use cheaper model choices independently of workflow activation. | A `claude -p` workflow needs a smoke-tested activation and allowlist. Workflow children use `acceptEdits` and inherit allowed tools; they do not inherit unrestricted parent permissions. |
| Codex | Native subagents, Ultra delegation, custom per-agent `model` and reasoning settings; the supplied analysis records `gpt-5.6-terra` as the lighter read-heavy worker recommendation at that time. | The supplied `codex exec` documentation does not establish the non-interactive spawn, permission, attribution and terminal-result contract required by the runner. Treat this integration as unverified and use dependency-linked cards until a recorded smoke test closes the gap. |

Orchestration capability and worker model choice are separate decisions. A cheap
worker pin can reduce the cost of bounded discovery or review, but it does not turn
ordinary subagent delegation into a scripted workflow or lower the correctness floor
for risky work.

## Solution

Use small, dependency-linked cards by default. Each card should own one coherent
outcome with its own acceptance evidence; it should not be so small that it contains
only pipeline ceremony.

Promote the work to one workflow-sized card only when all or nearly all of these are
true:

1. The chosen route is Claude-capable and the project's headless workflow activation
   and allowlist have passed a smoke test.
2. The task contains at least three repeatable, independent slices.
3. Workers can own disjoint paths or read-only questions without negotiating a
   changing shared interface.
4. One deterministic end-to-end gate validates the combined result.
5. The expected combined diff remains reviewable, or the workflow emits per-slice
   evidence and performs an explicit integration review.
6. No product, architecture or risk decision needs operator sign-off between slices.
7. Avoided repeated coding context and expected retries plausibly outweigh workflow
   planning, worker fan-out and synthesis.

Choose small cards whenever the route may select an unqualified provider, a slice
defines a dependency for the next, acceptance is independently provable, paths
overlap, steering or auditability matters, or a failure should not reopen completed
work.

When the answer is unclear, use a hybrid:

- Let a qualified workflow explore the problem and produce the card cut, then run
  and review the implementation as small cards.
- Run path-disjoint leaf cards in parallel, followed by one integration card that
  depends on every leaf and owns the end-to-end gate.
- Keep one writing owner while cheaper supporting agents perform read-only discovery,
  tests or review.

Start with one directory or the smallest useful workflow. Record the requested cut,
actual provider and CLI, activation path, worker count and models, per-agent tokens,
outer attempts, final diff size, review findings and fallback reason. Widen only when
that evidence shows a real benefit.

## Consequences

The default small-card path produces more claims, worktrees, gates and integration
events, but it preserves precise review, durable hand-offs, operator steering and a
small retry blast radius. Independent leaf cards may still run concurrently.

A qualified workflow-sized task can remove repeated outer lifecycle work, keep
intermediate results outside the parent context and reduce integration merges. In
exchange, it spends tokens on planning and worker context, combines attribution,
increases the size of review, and makes an outer failure more expensive. Its success
depends on a provider-specific headless permission path and on a strong combined
gate.

The policy may change as runner integrations are verified. A recorded Codex smoke
test can change the conservative routing decision without erasing the distinction
between native subagent parallelism and a script-owned workflow runtime.

No controlled Agent Studio experiment has yet run the same task both ways. This is
an Assess-ring decision rubric, not a claim that one cutting strategy saves a fixed
percentage.

## Relations

- **Validated trust:** a combined delivery is acceptable only when operators can
  judge it through reliable gates, structured verdicts and retained per-slice
  evidence.
- **Regression safety:** one end-to-end gate must protect previously passing behavior
  across all workflow slices; otherwise the larger blast radius is unjustified.
- **Skip the Pull Request:** when human diff review is not the integration gate, a
  workflow-sized combined diff raises the importance of deterministic gates,
  structured review envelopes and attributable evidence.

---

*Factual core: TE-23, “Dynamic Workflows as a Task-Cutting Strategy,” accepted
28 July 2026. External references registered with the pattern include the Agent
Studio pipeline-time-economy brief and analysis, Claude Code workflows and
subagents, and Codex subagents and non-interactive mode.*
