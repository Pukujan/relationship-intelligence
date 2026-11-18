# Pull request

## Human outcome

<!-- One sentence a newcomer can follow: what becomes easier, safer, or possible. -->

## Before and after

| | Before | After |
|---|---|---|
| | | |

## Change and scope

<!-- What changed, and what this deliberately does not touch. -->

## What stays unchanged

<!-- Behavior, data, and surfaces a reviewer should not expect to move. -->

## Verification

<!-- Commands run and their results. Link long logs rather than pasting them. -->

## Lineage

- Leaf issue:
- Parent:
- Task:
- Writer:

## Next action

<!-- One atomic next step. -->

<!-- pcm:issue-log-format:start -->
## Issue log format (issue-log-format 1.3.0)

<!-- pcm:policy {"id":"issue-log-format","policy_version":"1.3.0","protocol_version":"0.1.0-draft"} -->

**The issue-log shape is OIO's.** The canonical shape — required fields, lifecycle status, typed relations, and filer provenance — is defined by Observational Issue Ops ([`oio/` in `Pukujan/agent-stack-train`](https://github.com/Pukujan/agent-stack-train/tree/main/oio)): [`ontology/ISSUE_LOG_ONTOLOGY.md`](https://github.com/Pukujan/agent-stack-train/blob/main/oio/ontology/ISSUE_LOG_ONTOLOGY.md) is the semantic definition and [`.github/ISSUE_TEMPLATE/observational-issue.yml`](https://github.com/Pukujan/agent-stack-train/blob/main/oio/.github/ISSUE_TEMPLATE/observational-issue.yml) is the intake form. PCM does not define a competing form; fill OIO's shape and apply the writing rules below. **PCM owns the writing:** plain language, claim-first evidence, no unexplained acronym or bare identifier on first use, diagrams (mermaid), the reader-first pull-request shape, checkpoint and CURRENT projections, and the closing-keyword rule. **What an investigation record must say** (incidents, failures, research, design issues whose cause is not yet proven): numbered symptoms, each with a bold short name and one observable sentence; hypotheses with **Status** (unverified / confirmed / refuted / inconclusive), **Would confirm**, **Would refute**, and **Experiment**; evidence with provenance that names the hypothesis it supports or undercuts, plus a **Counter-signal** when one exists; an honest caveat; problems kept separate from gaps; and a **Proposal** labelled *(proposal)* that says none of it exists unless named as existing. That is guidance on what the record must say, not a second form schema. **Pull requests open reader-first:** problem and consequence, what changes, how to verify, and what stays unchanged; lineage links; evidence and one next action; long logs collapsed or linked; progress-only references use `Refs #<number>`, and a native closing keyword (`Closes`/`Fixes`/`Resolves #<number>`) only when the merge should resolve the issue. **Diagrams (mermaid):** when a record describes a flow with 4+ ordered steps or 2+ branches, add a fenced mermaid diagram *and* keep an adjacent text list or table so the record survives render failure; default to `graph TD` (vertical) because wide `LR` flows shrink to illegible strips on phones — reserve `LR` for 4 or fewer short nodes; cap 8 nodes and 6-word labels; wrap diagrams that may exceed the container width inside `<details>` (GitHub mounts the renderer lazily on expand); preview the rendered diagram before publishing (broken syntax shows a visible parse error) and never cite renderer URLs as standalone sources. **Readability rules:** the explain-the-reference rule is owned by Content Generation Modules, the single source for issue-log prose voice; read [CGM `docs/NARRATIVE_AUTHORITY.md` Rule 2](https://github.com/Pukujan/agent-stack-train/blob/main/cgm/docs/NARRATIVE_AUTHORITY.md#rule-2-explain-the-reference-before-it-carries-weight) rather than a copy here. Write evidence as the claim first, numbers as support (“nothing this change could break failed (263 tests, same six machine-environment failures as before)”), never bare counts; no unexplained acronym or bare identifier on first use in any tier; PR openings and checkpoint Completed/Next lines start with one problem sentence a newcomer can follow; the rule set applies to CURRENT projections and checkpoint entries exactly as to issue logs. No private absolute paths or secrets; link rather than paste long logs. See `docs/ISSUE_LOG_FORMAT.md` for the full format, exemplar, and examples.
<!-- pcm:issue-log-format:end -->
