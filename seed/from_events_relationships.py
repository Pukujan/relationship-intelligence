#!/usr/bin/env python3
"""
Convert the owner's `events_relationships` records into a seed file for
seed/load.py (#71).

The source is another Octo workspace where the owner kept a small relationship
graph: nodes (people, organisations, events, interactions), dated facts about
them, edges between them, and the source each fact came from. This script reads
it and writes the YAML that seed/load.py already validates. It writes nothing
to any Octo workspace; loading is seed/load.py's job, and it dry-runs by
default.

Rules this converter keeps, and why:

  * It reads the `events_relationships` schema and nothing else. The same
    workspace holds household and career tables (`public.user_context`,
    `career_coaching.*`) that are not relationship data and are about more
    than one person. Every query goes through `source_sql`, which refuses a
    statement that names any other schema.

  * A statement is written as sourced only when the source row has an http(s)
    URL and the source marked the fact `documented` or `third_party_reported`.
    Everything the owner reported, inferred or planned, and all free-text
    notes, go under `unverified:` with the source's own status in the text.
    PROJECT.md rule 5: sourced, or explicitly unverified.

  * One source person becomes one person. Nothing is matched to anyone already
    in the ledger. PROJECT.md rule 6: name plus employer never merges.

  * Only events the owner has a tie to are written: registered, invited,
    applied, attended, or an event where the owner met someone. The source
    also lists hundreds of merely discovered event listings.

  * The output holds personal data. The script refuses to write it inside the
    repository.

Usage:
    export SOURCE_OCTO_KEY=...            # a key for the SOURCE workspace
    export SOURCE_WORKSPACE_ID=...
    python seed/from_events_relationships.py --owner "Your Name" \\
        --out ~/.cache/acs/scratch/relationship-seed.yaml
    python seed/load.py --file ~/.cache/acs/scratch/relationship-seed.yaml          # dry run
    python seed/load.py --file ~/.cache/acs/scratch/relationship-seed.yaml --apply --project
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from typing import Any

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML:  pip install pyyaml")

SCHEMA = "events_relationships"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Octo answers at most 1000 rows per query; every query here is filtered to
# stay well under that, and `source_sql` fails loudly if one reaches the cap.
ROW_CAP = 1000

SOURCED_STATUSES = {"documented", "third_party_reported"}

# The owner's tie to an event, as the source records it.
TIED_INTEREST = {"registered", "applied", "attended_self_report",
                 "planning_to_attend_self_report", "previously_registered"}
TIED_REGISTRATION = {"invited", "confirmed", "invited_to_apply", "approved",
                     "pending_approval", "registered", "registration_approved",
                     "ticket_issued", "waitlisted"}

# Person attributes handled by name; every other attribute becomes a fact or a note.
HANDLED = {"name", "linkedin_url", "relationship_stage", "initial_meeting_context",
           "met_in_person", "role", "organization"}

_OTHER_SCHEMA = re.compile(r"\b(?:from|join)\s+(?!%s\.)[a-z_]+\." % SCHEMA, re.IGNORECASE)


def source_sql(statement: str) -> list[dict]:
    """Run one read-only query against the source workspace's relationship schema."""
    if not statement.lstrip().lower().startswith("select"):
        raise SystemExit("converter only reads: refusing a statement that is not a SELECT")
    if _OTHER_SCHEMA.search(statement) or f"{SCHEMA}." not in statement:
        raise SystemExit(f"converter only reads {SCHEMA}: refusing {statement[:80]!r}")
    base = os.environ.get("SOURCE_OCTO_URL", "https://octodb.design-bakery.com").rstrip("/")
    req = urllib.request.Request(
        f"{base}/api/workspaces/{os.environ['SOURCE_WORKSPACE_ID']}/query",
        data=json.dumps({"sql": statement}).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {os.environ['SOURCE_OCTO_KEY']}",
                 "User-Agent": "ri-seed-converter/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        rows = json.loads(response.read()).get("rows", [])
    if len(rows) >= ROW_CAP:
        raise SystemExit(f"query hit the {ROW_CAP}-row cap; narrow it: {statement[:80]!r}")
    return rows


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80] or "unnamed"


def day(value: Any) -> str | None:
    """A source timestamp as the YYYY-MM-DD string seed/load.py accepts."""
    text = str(value or "")
    return text[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", text) else None


def plain(value: Any) -> str:
    """A fact's JSON value as one line of text."""
    if value is None:
        return ""
    if isinstance(value, list):
        return "; ".join(plain(item) for item in value if plain(item))
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return re.sub(r"\s+", " ", str(value)).strip()


def label(attribute: str) -> str:
    return attribute.replace("_", " ").capitalize()


def is_url(text: Any) -> bool:
    return str(text or "").startswith(("http://", "https://"))


def facts_for(node_types: tuple[str, ...]) -> dict[int, dict[str, dict]]:
    """Current facts for nodes of the given types: node id -> attribute -> fact."""
    kinds = ", ".join("'" + kind + "'" for kind in node_types)
    rows = source_sql(
        f"SELECT f.node_id, f.attribute, f.value, f.epistemic_status, f.recorded_at, "
        f"s.source_kind, s.source_url, s.accessed_at, s.happened_at "
        f"FROM {SCHEMA}.node_facts f JOIN {SCHEMA}.nodes n ON n.id = f.node_id "
        f"LEFT JOIN {SCHEMA}.sources s ON s.id = f.evidence_source_id "
        f"WHERE n.node_type IN ({kinds}) AND f.valid_to IS NULL"
    )
    out: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        out[int(row["node_id"])][row["attribute"]] = row
    return out


def sourced(fact: dict) -> bool:
    return fact.get("epistemic_status") in SOURCED_STATUSES and is_url(fact.get("source_url"))


def build(owner: str) -> dict:
    nodes = source_sql(f"SELECT id, node_key, node_type FROM {SCHEMA}.nodes "
                       f"WHERE node_type IN ('person', 'organization', 'interaction', 'self')")
    by_id = {int(n["id"]): n for n in nodes}
    facts = facts_for(("person", "organization", "interaction"))
    edges = source_sql(
        f"SELECT e.from_node_id, e.to_node_id, e.relation, e.epistemic_status, e.recorded_at, "
        f"s.source_url FROM {SCHEMA}.edges e "
        f"LEFT JOIN {SCHEMA}.sources s ON s.id = e.evidence_source_id WHERE e.valid_to IS NULL"
    )
    calendar = source_sql(
        f"SELECT event_key, title, event_date, interest_status, registration_status, "
        f"official_url, source_url FROM {SCHEMA}.calendar"
    )
    event_nodes = {int(n["id"]): n["node_key"] for n in source_sql(
        f"SELECT id, node_key FROM {SCHEMA}.nodes WHERE node_type = 'event'")}
    event_by_key = {row["event_key"]: row for row in calendar}

    def name_of(node_id: int) -> str:
        return plain(facts.get(node_id, {}).get("name", {}).get("value")) or by_id[node_id]["node_key"]

    # Organisations.
    orgs: dict[str, dict] = {}
    org_slug_of: dict[int, str] = {}
    for node in nodes:
        if node["node_type"] != "organization":
            continue
        node_id = int(node["id"])
        org = slug(node["node_key"].split(":", 1)[-1])
        org_slug_of[node_id] = org
        orgs[org] = {"org": org, "display_name": name_of(node_id)}

    works_at: dict[int, tuple[int, dict]] = {}
    met_at: dict[int, list[int]] = defaultdict(list)
    involves: dict[int, list[int]] = defaultdict(list)   # interaction -> people
    about_event: dict[int, list[int]] = defaultdict(list)  # interaction -> events
    for edge in edges:
        a, b = int(edge["from_node_id"]), int(edge["to_node_id"])
        if edge["relation"] == "WORKS_AT":
            works_at[a] = (b, edge)
        elif edge["relation"] == "MET_AT":
            met_at[a].append(b)
        elif edge["relation"] in ("INVOLVES_PERSON", "EMAIL_FROM"):
            involves[a].append(b)
        elif edge["relation"] == "ABOUT_EVENT":
            about_event[a].append(b)

    def event_title(node_id: int) -> str:
        row = event_by_key.get(event_nodes.get(node_id, ""), {})
        return plain(row.get("title")) or event_nodes.get(node_id, "an event")

    people: list[dict] = []
    unverified: list[dict] = []
    connections: list[dict] = []
    slug_of: dict[int, str] = {}
    attendees: dict[str, list[str]] = defaultdict(list)

    for node in sorted(nodes, key=lambda n: n["node_key"]):
        if node["node_type"] != "person":
            continue
        node_id = int(node["id"])
        mine = facts.get(node_id, {})
        display = name_of(node_id)
        person = slug(node["node_key"].split(":", 1)[-1])
        slug_of[node_id] = person
        entry: dict[str, Any] = {"person": person, "display_name": display}

        def note(text: str, when: Any = None) -> None:
            unverified.append({"person": person, "note": f"{display}: {text}",
                               **({"observed_at": day(when)} if day(when) else {})})

        sourced_facts: list[dict] = []
        linkedin = mine.get("linkedin_url")
        if linkedin and is_url(plain(linkedin["value"])):
            url = plain(linkedin["value"])
            sourced_facts.append({"text": f"{display}'s LinkedIn profile is {url}",
                                  "attribute": "linkedin_url", "source": url,
                                  **({"retrieved": day(linkedin.get("accessed_at") or linkedin["recorded_at"])}
                                     if day(linkedin.get("accessed_at") or linkedin["recorded_at"]) else {})})

        # A role is a WORKS_AT claim only when the source documented it at a URL.
        role, employer = mine.get("role"), works_at.get(node_id)
        title = plain(role["value"]) if role else ""
        if employer and title and is_url(employer[1].get("source_url")) \
                and employer[1].get("epistemic_status") in SOURCED_STATUSES:
            entry["roles"] = [{"org": org_slug_of[employer[0]], "title": title,
                               "source": employer[1]["source_url"],
                               **({"retrieved": day(employer[1]["recorded_at"])}
                                  if day(employer[1]["recorded_at"]) else {})}]
        else:
            org_text = plain(mine.get("organization", {}).get("value")) or (
                orgs[org_slug_of[employer[0]]]["display_name"] if employer else "")
            if title or org_text:
                status = (role or mine.get("organization") or {}).get("epistemic_status", "self_reported")
                note(f"({status.replace('_', ' ')}) "
                     + " at ".join(part for part in (title, org_text) if part),
                     (role or mine.get("organization") or {}).get("recorded_at"))

        for attribute, fact in sorted(mine.items()):
            if attribute in HANDLED:
                continue
            text = plain(fact["value"])
            if not text:
                continue
            if sourced(fact):
                when = day(fact.get("accessed_at") or fact["recorded_at"])
                sourced_facts.append({"text": f"{display}, {label(attribute).lower()}: {text}",
                                      "attribute": attribute, "source": fact["source_url"],
                                      **({"retrieved": when} if when else {})})
            else:
                note(f"({str(fact.get('epistemic_status') or 'unverified').replace('_', ' ')}) "
                     f"{label(attribute)}: {text}", fact["recorded_at"])
        if sourced_facts:
            entry["facts"] = sourced_facts

        # How the owner knows this person: the owner's own account, so no evidence.
        stage = plain(mine.get("relationship_stage", {}).get("value"))
        context = plain(mine.get("initial_meeting_context", {}).get("value"))
        in_person = stage.startswith("met_in_person") or plain(mine.get("met_in_person", {}).get("value")).lower() == "true"
        when = day(mine.get("relationship_stage", {}).get("recorded_at"))
        connections.append({"person": person, "strength": "met-once" if in_person else "weak",
                            "basis": context or stage.replace("_", " ") or "recorded contact",
                            "source": "personal", **({"retrieved": when} if when else {})})
        if stage:
            note(f"(relationship stage) {stage.replace('_', ' ')}",
                 mine.get("relationship_stage", {}).get("recorded_at"))

        for event_id in met_at.get(node_id, []):
            note(f"(self reported) met at {event_title(event_id)}")
            key = event_nodes.get(event_id)
            if key:
                attendees[key].append(person)

        people.append(entry)

    # Interactions: the owner's private log. Always unverified notes on the people involved.
    for node in nodes:
        if node["node_type"] != "interaction":
            continue
        node_id = int(node["id"])
        mine = facts.get(node_id, {})
        head = ", ".join(part for part in (
            plain(mine.get("channel", {}).get("value")),
            plain(mine.get("conversation_type", {}).get("value")),
            plain(mine.get("interaction_status", {}).get("value")),
        ) if part)
        events_text = ", ".join(event_title(e) for e in about_event.get(node_id, []))
        body = " ".join(part for part in (
            plain(mine.get("title", {}).get("value")) + "." if mine.get("title") else "",
            f"At {events_text}." if events_text else "",
            *(f"{label(a)}: {plain(mine[a]['value'])}." for a in sorted(mine)
              if a not in ("channel", "conversation_type", "interaction_status", "title")
              and plain(mine[a]["value"])),
        ) if part)
        when = (mine.get("title") or next(iter(mine.values()), {})).get("recorded_at")
        for person_id in involves.get(node_id, []):
            if person_id in slug_of:
                unverified.append({
                    "person": slug_of[person_id],
                    "note": f"{name_of(person_id)}: (private interaction log; {head}) {body}",
                    **({"observed_at": day(when)} if day(when) else {}),
                })

    # Events the owner has a tie to.
    events: list[dict] = []
    for row in sorted(calendar, key=lambda r: str(r["event_date"])):
        key = row["event_key"]
        tied = (row.get("interest_status") in TIED_INTEREST
                or row.get("registration_status") in TIED_REGISTRATION
                or key in attendees)
        if not tied:
            continue
        url = row.get("official_url") if is_url(row.get("official_url")) else row.get("source_url")
        events.append({
            "event": slug(key.split(":", 1)[-1]),
            "display_name": plain(row.get("title")) or key,
            "kind": "event",
            **({"year": int(str(row["event_date"])[:4])} if day(row.get("event_date")) else {}),
            **({"url": url} if is_url(url) else {}),
            "source": url if is_url(url) else f"octo:{SCHEMA}/{key}",
            **({"attendees": sorted(set(attendees[key]))} if key in attendees else {}),
        })

    # The owner, so "how we met" has two ends. seed/load.py records it from both.
    people.insert(0, {"person": "workspace-owner", "display_name": owner,
                      "confirmed_identity": True, "connected_to": connections})

    return {"people": people, "orgs": list(orgs.values()), "events": events,
            "unverified": unverified}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", required=True, help="the owner's display name")
    ap.add_argument("--out", required=True, help="where to write the seed file (outside the repository)")
    args = ap.parse_args()
    for name in ("SOURCE_OCTO_KEY", "SOURCE_WORKSPACE_ID"):
        if not os.environ.get(name):
            sys.exit(f"set {name}")
    out = os.path.abspath(os.path.expanduser(args.out))
    if out == REPO or out.startswith(REPO + os.sep):
        sys.exit("the seed file holds personal data: write it outside the repository")

    doc = build(args.owner)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        yaml.safe_dump(doc, handle, sort_keys=False, allow_unicode=True, width=1000)

    people = doc["people"]
    print(json.dumps({
        "people": len(people) - 1,
        "organisations": len(doc["orgs"]),
        "events": len(doc["events"]),
        "sourced facts": sum(len(p.get("facts") or []) for p in people),
        "sourced roles": sum(len(p.get("roles") or []) for p in people),
        "how-we-met connections": len(people[0]["connected_to"]),
        "unverified notes": len(doc["unverified"]),
        "written to": out,
    }, indent=2))


if __name__ == "__main__":
    main()
