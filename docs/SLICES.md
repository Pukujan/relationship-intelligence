# Slice Packet Template

Each owning issue fills this before implementation. The packet is compact and specific to one user job.

## PDD

- User/actor:
- Job:
- Why now:
- In scope:
- Out of scope:
- Reuse:
- Observable success:

## SDD

- Canonical state and ownership:
- Octo capabilities:
- Runtime/API contracts:
- Source/provider data flow:
- Client surfaces:
- Existing code reused/replaced:
- Failure boundary:
- Current/stale behavior:

## Eval / completion oracle

- Public deterministic tests:
- Real user-flow test:
- Metamorphic relations:
- Hidden holdout, if needed:
- Production smoke, if deployed:
- Acceptance-to-test traceability:

## Lock and done

Implementation begins after owner acceptance. Completion requires the accepted user job, all declared evals, green CI on the candidate, and any declared production smoke. The implementation must not add out-of-scope infrastructure or product machinery.
