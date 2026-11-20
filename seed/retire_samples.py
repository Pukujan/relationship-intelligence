#!/usr/bin/env python3
"""
Retire the sample records that seed/people.yaml put in the ledger (#71).

The ledger is append-only and corrections supersede (PROJECT.md rule 7), so
nothing is deleted. For every entity named in the sample file:

  * each of its current claims is superseded by a new claim whose provenance
    verb is RETIRED, which closes the old claim and keeps it in history;
  * an entity with no claims of its own (the sample organisations and event)
    gets one RETIRED claim, so the app has something to read.

The app hides an entity whose only current claims are retirements
(`retiredEntityIds` in app/server/world.ts).

Dry run by default.

    set -a; . ./.env; set +a
    python seed/retire_samples.py                 # what would be retired
    python seed/retire_samples.py --apply --project
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML:  pip install pyyaml")

import load  # noqa: E402  (the loader's API helpers)

REASON = "Sample record from seed/people.yaml, retired when real records were imported (#71)."


def sample_names(path: str) -> set[str]:
    with open(path) as handle:
        doc = yaml.safe_load(handle)
    names = {p["display_name"] for p in doc.get("people") or []}
    names |= {o.get("display_name", o["org"]) for o in doc.get("orgs") or []}
    names |= {e.get("display_name", e["event"]) for e in doc.get("events") or []}
    return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="seed/people.yaml", help="the sample seed file")
    ap.add_argument("--also", action="append", default=[],
                    help="another entity name to retire, e.g. a leftover test record (repeatable)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--project", action="store_true", help="rebuild the graph afterwards")
    args = ap.parse_args()

    names = sample_names(args.file) | set(args.also)
    entities = [row for row in load.api_query(
        "MATCH (e:Entity) RETURN e.id AS id, e.name AS name").get("rows", [])
        if row["name"] in names]
    claims = load.api_query(
        "MATCH (c:Claim)-[:SUBJECT]->(e:Entity) RETURN c.id AS id, c.statement AS statement, "
        "c.supersededAt AS supersededAt, c.provenance AS provenance, e.id AS entityId"
    ).get("rows", [])

    plan: list[dict] = []
    for entity in entities:
        mine = [c for c in claims if c["entityId"] == entity["id"] and not c["supersededAt"]]
        live = []
        for claim in mine:
            try:
                verb = json.loads(claim.get("provenance") or "{}").get("verb")
            except (TypeError, ValueError):
                verb = None
            if verb != "RETIRED":
                live.append(claim)
        if mine and not live:
            continue  # already retired
        for claim in live:
            plan.append({"entity": entity, "supersedes": claim["id"],
                         "statement": f"[RETIRED] {claim['statement']}"})
        if not mine:
            plan.append({"entity": entity, "supersedes": None,
                         "statement": f"[RETIRED] {entity['name']} was a sample record."})

    print(f"sample entities found: {len(entities)} of {len(names)} named in {args.file}", file=sys.stderr)
    print(f"plan: {len(plan)} retirement claims "
          f"({sum(1 for p in plan if p['supersedes'])} supersede a claim)", file=sys.stderr)
    if not args.apply:
        print("(dry run — pass --apply to write)", file=sys.stderr)
        return

    now = load._today()
    for item in plan:
        fields = {
            "subjectEntityId": item["entity"]["id"],
            "statement": item["statement"],
            "validFrom": now,
            "validTo": None,
            "recordedAt": now,
            "provenance": {"verb": "RETIRED", "reason": REASON,
                           "seedId": load._seed_id(item["statement"], "RETIRED", item["entity"]["id"])},
        }
        if item["supersedes"]:
            fields["supersedesClaimId"] = item["supersedes"]
        load.record("claim", **fields)
    print("retired.", file=sys.stderr)
    if args.project:
        print(f"graph rebuilt: {json.dumps(load.project_graph())[:200]}", file=sys.stderr)


if __name__ == "__main__":
    main()
