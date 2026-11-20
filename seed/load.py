#!/usr/bin/env python3
"""
Load people.yaml into an Octo workspace's epistemic ledger.

Design decisions, and why:

  * Writes go through POST /api/epistemic/record (kind = entity | claim |
    evidence | claim_evidence | belief | perspective), NOT raw SQL. Octo's
    epistemic ledger lives in its control-plane schema; a workspace's own
    Postgres database is a separate, empty database and has no octo.* tables.

  * We never touch FalkorDB. The graph is a disposable read model rebuilt by
    POST /api/graph/project from the ledger, so the ledger is the only thing
    worth writing.

  * Every structural fact becomes a claim whose JSON `provenance` carries
    {"verb": ...}. That verb is what queries/social.cypher filters on. Encoded
    verbs: WORKS_AT, MET, PRESENTED_AT, BUILT, POSITION, FACT.

  * A POSITION needs a verbatim quote: a real sentence, not a label you wrote.
    Paraphrasing someone's beliefs into your own words is the failure mode this
    whole project is most vulnerable to, so the loader refuses it.

  * `unverified:` entries are written with stance 'uncertain' and no evidence.
    They stay in the ledger (nothing is silently dropped) but carry no CITES
    edge, so every query in social.cypher leaves them out.

Usage:
    cp .env.example .env      # then fill it in
    set -a; . ./.env; set +a

    python seed/load.py --file seed/people.yaml            # dry run (default)
    python seed/load.py --file seed/people.yaml --apply    # write
    python seed/load.py --file seed/people.yaml --apply --project   # + rebuild graph
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date
from typing import Any

try:
    import yaml
except ImportError:
    sys.exit("needs PyYAML:  pip install pyyaml")


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

class SeedError(Exception):
    pass


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise SeedError(msg)


def _iso(value: Any, field: str, where: str) -> str | None:
    """Coerce a YAML date or 'YYYY-MM' string to an ISO timestamp Octo accepts."""
    if value is None:
        return None
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00Z"
    if isinstance(value, str):
        return f"{value}-01T00:00:00Z" if len(value) == 7 else f"{value}T00:00:00Z"
    raise SeedError(f"{where}: {field} must be a date or YYYY-MM, got {value!r}")


def _today() -> str:
    return f"{date.today().isoformat()}T00:00:00Z"


def validate(doc: dict) -> list[str]:
    """Returns warnings; raises SeedError for anything that must not be stored."""
    warnings: list[str] = []
    people = doc.get("people") or []
    _require(bool(people), "no people in seed file")

    slugs = {p["person"] for p in people}
    orgs = {o["org"] for o in (doc.get("orgs") or [])}

    for p in people:
        who = f"person {p['person']}"
        _require("display_name" in p, f"{who}: display_name is required")

        for h in p.get("handles") or []:
            _require(bool(h.get("source")), f"{who}: handle {h.get('username')} has no source")

        for r in p.get("roles") or []:
            _require(r.get("org") in orgs, f"{who}: role org {r.get('org')!r} not declared under orgs:")
            _require(bool(r.get("source")), f"{who}: role at {r.get('org')} has no source")

        for pos in p.get("positions") or []:
            quote = (pos.get("quote") or "").strip()
            _require(
                len(quote) >= 25 and len(quote.split()) >= 5,
                f"{who}: position on {pos.get('topic')!r} needs a verbatim quote of a real "
                f"sentence (got {len(quote)} chars / {len(quote.split())} words: {quote!r})",
            )
            _require(
                any(m in quote for m in (".", ",", "—", ":", ";", '"', "'", "?", "!")),
                f"{who}: quote on {pos.get('topic')!r} has no sentence punctuation, which "
                f"usually means it is a label you wrote rather than something they said",
            )
            _require(bool(pos.get("source")), f"{who}: position on {pos.get('topic')!r} has no source")
            _require(
                pos.get("stance") in {"believes", "disbelieves", "uncertain"},
                f"{who}: stance must be believes/disbelieves/uncertain",
            )
            conf = pos.get("confidence")
            if conf is not None:
                _require(0 <= float(conf) <= 1, f"{who}: confidence must be 0..1")

        for c in p.get("connected_to") or []:
            _require(c.get("person") in slugs, f"{who}: connects to unknown person {c.get('person')!r}")
            _require(
                c.get("strength") in {"strong", "weak", "met-once"},
                f"{who}: strength must be strong/weak/met-once",
            )
            _require(bool(c.get("basis")), f"{who}: connection to {c.get('person')} needs a basis")

        for t in p.get("talks") or []:
            _require(bool(t.get("source")), f"{who}: talk {t.get('title')!r} has no source")

        # A fact is any other sourced statement about the person (a profile
        # link, a public role summary). It is "sourced" only if the source is
        # something a reader can open, so a URL is required; anything the
        # owner merely knows belongs under `unverified:` instead.
        for f in p.get("facts") or []:
            text = (f.get("text") or "").strip()
            _require(bool(text), f"{who}: a fact has no text")
            _require(
                str(f.get("source") or "").startswith(("http://", "https://")),
                f"{who}: fact {text[:40]!r} needs a URL source; put it under unverified: if it has none",
            )

        if len(p.get("handles") or []) > 1 and not p.get("confirmed_identity"):
            warnings.append(
                f"{who}: {len(p['handles'])} handles but confirmed_identity is false — "
                f"'same human' is itself an unverified claim"
            )

    for e in doc.get("events") or []:
        _require(bool(e.get("source")), f"event {e.get('event')}: no source")
        for a in e.get("attendees") or []:
            _require(a in slugs, f"event {e['event']}: unknown attendee {a!r}")

    return warnings


# --------------------------------------------------------------------------
# Plan construction
# --------------------------------------------------------------------------

def build_plan(doc: dict) -> dict[str, list[dict]]:
    """Turns the YAML into the ordered row set: entities, then claims, then links."""
    entities: list[dict] = []
    seen: set[str] = set()

    def add_entity(name: str, etype: str) -> None:
        if name in seen:
            return
        seen.add(name)
        entities.append({"name": name, "entityType": etype})

    for o in doc.get("orgs") or []:
        add_entity(o.get("display_name", o["org"]), f"org:{o['org']}")
    for e in doc.get("events") or []:
        add_entity(e.get("display_name", e["event"]), f"event:{e['event']}")
    for p in doc.get("people") or []:
        add_entity(p["display_name"], "person")

    claims: list[dict] = []
    beliefs: list[dict] = []

    def claim(subject: str, statement: str, verb: str, extra: dict,
              valid_from: str | None, recorded_at: str, evidence: list[dict]) -> int:
        idx = len(claims)
        claims.append({
            "subject_name": subject,
            "statement": statement,
            "verb": verb,
            "valid_from": valid_from,
            "valid_to": None,
            "recorded_at": recorded_at or _today(),
            "provenance": {
                "verb": verb,
                "seedId": _seed_id(statement, verb, extra.get("direction", "")),
                **extra,
            },
            "evidence": evidence,
        })
        return idx

    org_name = {o["org"]: o.get("display_name", o["org"]) for o in (doc.get("orgs") or [])}
    people_by_slug = {p["person"]: p for p in (doc.get("people") or [])}

    for p in doc.get("people") or []:
        who = p["display_name"]

        for r in p.get("roles") or []:
            claim(who, f"{who} works at {org_name[r['org']]} as {r['title']}", "WORKS_AT",
                  {"org": r["org"], "title": r["title"]},
                  _iso(r.get("from"), "from", p["person"]),
                  _iso(r.get("retrieved"), "retrieved", p["person"]),
                  [{"locator": r["source"], "quote": None}])

        for c in p.get("connected_to") or []:
            peer = people_by_slug[c["person"]]["display_name"]
            # Record the link from BOTH sides. Octo's graph has no entity-to-entity
            # edges, so a relationship exists only as a claim on a person. Storing
            # it one-way means "Jane knows Sam" is invisible when you start from
            # Sam -- exactly the direction you usually need. The reverse claim is
            # its own statement, so it is not a duplicate; both cite the same basis.
            basis = c["basis"]
            claim(who, f"{who} knows {peer} ({c['strength']})", "MET",
                  {"peer": c["person"], "strength": c["strength"], "basis": basis,
                   "direction": "outbound"},
                  _iso(c.get("retrieved"), "retrieved", p["person"]),
                  _iso(c.get("retrieved"), "retrieved", p["person"]),
                  [] if c.get("source") == "personal" else [{"locator": c["source"], "quote": None}])
            claim(peer, f"{peer} knows {who} ({c['strength']})", "MET",
                  {"peer": p["person"], "strength": c["strength"], "basis": basis,
                   "direction": "inbound"},
                  _iso(c.get("retrieved"), "retrieved", p["person"]),
                  _iso(c.get("retrieved"), "retrieved", p["person"]),
                  [] if c.get("source") == "personal" else [{"locator": c["source"], "quote": None}])

        for t in p.get("talks") or []:
            claim(who, f"{who} presented {t['title']!r} at {t['venue']}", "PRESENTED_AT",
                  {"title": t["title"], "venue": t["venue"]},
                  f"{t['year']}-01-01T00:00:00Z",
                  _iso(t.get("retrieved"), "retrieved", p["person"]),
                  [{"locator": t["source"], "quote": None}])

        for pr in p.get("projects") or []:
            claim(who, f"{who} built {pr['name']}: {pr.get('description', '')}".strip(), "BUILT",
                  {"name": pr["name"]},
                  _iso(pr.get("retrieved"), "retrieved", p["person"]),
                  _iso(pr.get("retrieved"), "retrieved", p["person"]),
                  [{"locator": pr["source"], "quote": None}])

        for f in p.get("facts") or []:
            claim(who, f["text"].strip(), "FACT",
                  {"attribute": f.get("attribute", "")},
                  _iso(f.get("observed_at") or f.get("retrieved"), "observed_at", p["person"]),
                  _iso(f.get("retrieved") or f.get("observed_at"), "retrieved", p["person"]),
                  [{"locator": f["source"], "quote": None}])

        for pos in p.get("positions") or []:
            idx = claim(who, f"{who} on {pos['topic']}: {pos['stance']}", "POSITION",
                        {"topic": pos["topic"]},
                        _iso(pos.get("retrieved"), "retrieved", p["person"]),
                        _iso(pos.get("retrieved"), "retrieved", p["person"]),
                        [{"locator": pos["source"], "quote": pos["quote"]}])
            beliefs.append({
                "perspective": f"public-statement:{p['person']}",
                "claim_ref": idx,
                "stance": pos["stance"],
                "confidence": pos.get("confidence"),
            })

    # Unverified: recorded, no evidence, stance uncertain -> unreachable by queries.
    for u in doc.get("unverified") or []:
        if u["person"] not in people_by_slug:
            continue
        who = people_by_slug[u["person"]]["display_name"]
        idx = claim(who, f"[UNVERIFIED] {u['note']}", "UNVERIFIED", {},
                    _iso(u.get("observed_at"), "observed_at", u["person"]),
                    _iso(u.get("observed_at"), "observed_at", u["person"]),
                    [])
        beliefs.append({"perspective": "lead", "claim_ref": idx,
                        "stance": "uncertain", "confidence": None})

    return {"entities": entities, "claims": claims, "beliefs": beliefs}


# --------------------------------------------------------------------------
# Octo API
# --------------------------------------------------------------------------

def _api(path: str, body: dict | None = None) -> dict:
    base = os.environ.get("OCTO_API_URL", "").rstrip("/")
    key = os.environ.get("OCTO_API_KEY", "")
    if not (base and key):
        sys.exit("set OCTO_API_URL and OCTO_API_KEY (see .env.example)")

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{base}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Octo sits behind Cloudflare, which answers 403 "error code: 1010"
            # to urllib's default Python-urllib/x.y fingerprint.
            "User-Agent": "social-graph-loader/1.0",
        },
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Octo {e.code} on {path}: {e.read().decode()[:600]}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"cannot reach Octo at {base}: {e}") from None


def record(kind: str, **fields) -> dict:
    ws = os.environ["OCTO_WORKSPACE_ID"]
    return _api("/api/epistemic/record", {"workspaceId": ws, "kind": kind, **fields})


def _seed_id(statement: str, verb: str, extra: str = "") -> str:
    """
    A stable id for one seed fact, carried in provenance as `seedId`.

    The ledger is append-only, so re-running this loader would otherwise append a
    second copy of every claim and every query would return each row twice. Rather
    than special-casing dedupe in ten queries, we make each seed fact identifiable
    and skip it when it already exists. Keyed on statement + verb + qualifier,
    which is exactly the granularity of "is this the same fact as before".
    """
    return hashlib.sha256(f"{verb}\x00{statement}\x00{extra}".encode()).hexdigest()[:16]


def existing_seed_ids() -> set[str]:
    """Seed ids already present in the ledger, read back from the graph."""
    try:
        res = api_query(
            "MATCH (c:Claim) WHERE c.provenance CONTAINS '\"seedId\"' "
            "RETURN c.provenance AS p"
        )
    except SystemExit:
        return set()
    ids = set()
    for row in res.get("rows", []):
        try:
            ids.add(json.loads(row["p"])["seedId"])
        except (KeyError, TypeError, ValueError):
            continue
    return ids


def api_query(cypher: str) -> dict:
    return _api("/api/graph/query", {"workspaceId": os.environ["OCTO_WORKSPACE_ID"],
                                     "query": cypher, "params": {}})



def _lookup_claim_by_seed(seed_id: str) -> str | None:
    """Find an already-recorded claim by its seedId, so a new belief can attach."""
    res = api_query(
        f"MATCH (c:Claim) WHERE c.provenance CONTAINS '\"seedId\":\"{seed_id}\"' "
        "RETURN c.id AS id LIMIT 1"
    )
    rows = res.get("rows") or []
    return rows[0]["id"] if rows else None


def apply_plan(plan: dict) -> None:
    entity_ids: dict[str, str] = {}

    for ent in plan["entities"]:
        res = record("entity", name=ent["name"], entityType=ent["entityType"])
        entity_ids[ent["name"]] = res["entity"]["id"]

    perspective_ids: dict[str, str] = {}

    # Skip facts already in the ledger: the ledger is append-only, so without this
    # every re-run doubles every row and every query returns each twice.
    already = existing_seed_ids()
    skipped = 0
    written = 0

    for cl in plan["claims"]:
        if cl["provenance"]["seedId"] in already:
            skipped += 1
            # Still remember where it lives, so a belief can attach to it.
            found = _lookup_claim_by_seed(cl["provenance"]["seedId"])
            if found:
                _WRITTEN_CLAIMS[cl["statement"]] = found
            continue

        res = record(
            "claim",
            subjectEntityId=entity_ids.get(cl["subject_name"]),
            statement=cl["statement"],
            validFrom=cl["valid_from"],
            validTo=cl["valid_to"],
            recordedAt=cl["recorded_at"],
            provenance=cl["provenance"],
        )
        claim_id = res["claim"]["id"]
        written += 1

        for ev in cl["evidence"]:
            evres = record("evidence", locator=ev.get("locator"), quote=ev.get("quote"))
            record("claim_evidence", claimId=claim_id,
                   evidenceId=evres["evidence"]["id"], stance="supports")

    print(f"claims: {written} new, {skipped} already present", file=sys.stderr)

    for b in plan["beliefs"]:
        pname = b["perspective"]
        if pname not in perspective_ids:
            res = record("perspective", name=pname,
                         description="Auto-created by seed/load.py")
            perspective_ids[pname] = res["perspective"]["id"]

        cl = plan["claims"][b["claim_ref"]]
        # Re-resolve the claim id by statement: beliefs are written after all claims,
        # and a statement is unique per seed entry.
        found = _find_claim_id(cl["statement"])
        if not found:
            print(f"skip belief (claim not found): {cl['statement']}", file=sys.stderr)
            continue
        record("belief", perspectiveId=perspective_ids[pname], claimId=found,
               stance=b["stance"], confidence=b["confidence"])


def _find_claim_id(statement: str) -> str | None:
    """Look the claim up through the SQL surface's read of the ledger isn't available,
    so we keep a local map instead."""
    return _WRITTEN_CLAIMS.get(statement)


_WRITTEN_CLAIMS: dict[str, str] = {}


def _install_claim_memo() -> None:
    """Wrap `record` so every claim we write is remembered by statement."""
    original = record

    def wrapper(kind: str, **fields):
        res = original(kind, **fields)
        if kind == "claim":
            _WRITTEN_CLAIMS[fields["statement"]] = res["claim"]["id"]
        return res

    globals()["record"] = wrapper


def project_graph() -> dict:
    ws = os.environ["OCTO_WORKSPACE_ID"]
    return _api("/api/graph/project", {"workspaceId": ws})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="seed/people.yaml")
    ap.add_argument("--apply", action="store_true", help="actually write to the ledger")
    ap.add_argument("--project", action="store_true", help="rebuild the graph afterwards")
    args = ap.parse_args()

    with open(args.file) as fh:
        doc = yaml.safe_load(fh)

    try:
        warnings = validate(doc)
    except SeedError as e:
        sys.exit(f"seed invalid: {e}")
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)

    plan = build_plan(doc)
    print(
        f"plan: {len(plan['entities'])} entities, {len(plan['claims'])} claims, "
        f"{len(plan['beliefs'])} beliefs",
        file=sys.stderr,
    )

    if not args.apply:
        print(json.dumps(plan, indent=2, default=str)[:3000])
        print("\n(dry run — pass --apply to write)", file=sys.stderr)
        return

    _install_claim_memo()
    apply_plan(plan)
    print("written to ledger.", file=sys.stderr)

    if args.project:
        print(f"graph rebuilt: {json.dumps(project_graph())}", file=sys.stderr)
    else:
        print("rebuild the graph with: POST /api/graph/project", file=sys.stderr)


if __name__ == "__main__":
    main()


