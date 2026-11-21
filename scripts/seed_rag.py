#!/usr/bin/env python3
"""Populate Octo RAG with the workspace's evidence-backed sourced claims.

The RAG pipeline was wired but empty: /api/rag/query returned no matches because
no source text had been ingested. This script derives searchable text from the
canonical ledger's SOURCED claims (those with an evidence CITES locator), never
from unverified notes, so the index stays aligned with PROJECT.md rule 5.

Each document is one claim with its evidence locator and verbatim excerpt when
available. Stable content hashes make re-runs idempotent: Octo deduplicates
identical text, and the script reports created vs existing.

Dry run by default. Use --apply to write.

Usage:
    python3 scripts/seed_rag.py                 # dry run: report what would be ingested
    python3 scripts/seed_rag.py --apply         # ingest sourced claims into Octo RAG
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def env_value(name: str) -> str:
    for path in (os.path.join(ROOT, "app", ".env"), os.path.join(ROOT, ".env")):
        try:
            with open(path) as handle:
                for line in handle:
                    if line.startswith(name + "="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            continue
    return os.environ.get(name, "")


def api(path: str, body: dict[str, Any] | None, base: str, key: str) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body or {}).encode() if body is not None else None,
        method="POST" if body is not None else "GET",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "ri-seed-rag/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def display_locator(locator: str) -> str:
    try:
        return locator
    except Exception:
        return locator


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write documents to RAG")
    parser.add_argument("--limit", type=int, default=0, help="ingest at most N claims (0 = all)")
    args = parser.parse_args()

    base = env_value("OCTO_API_URL").rstrip("/")
    key = env_value("OCTO_API_KEY")
    ws = env_value("OCTO_WORKSPACE_ID")
    if not base or not key or not ws:
        print("missing OCTO_API_URL / OCTO_API_KEY / OCTO_WORKSPACE_ID", file=sys.stderr)
        return 2

    query = (
        "MATCH (c:Claim)-[:CITES]->(v:Evidence) "
        "MATCH (c)-[:SUBJECT]->(e:Entity) "
        "RETURN c.id AS claimId, c.statement AS statement, c.validFrom AS validFrom, "
        "c.provenance AS provenance, v.locator AS locator, v.quote AS excerpt, "
        "e.name AS subject"
    )
    rows = api(
        "/api/graph/query",
        {"workspaceId": ws, "query": query, "params": {}},
        base,
        key,
    ).get("rows", [])

    documents: list[dict[str, Any]] = []
    for row in rows:
        if row.get("supersededAt"):
            continue
        locator = str(row.get("locator") or "").strip()
        statement = str(row.get("statement") or "").strip()
        if not locator or not statement:
            continue
        try:
            provenance = json.loads(row.get("provenance") or "{}")
        except (ValueError, TypeError):
            provenance = {}
        # Retired / duplicate markers are bookkeeping, not relationship facts.
        if provenance.get("verb") in {"RETIRED", "SUPERSEDED_DUPLICATE", "DUP_MARKER"}:
            continue
        excerpt = str(row.get("excerpt") or "").strip()
        subject = str(row.get("subject") or "").strip()
        parts = [f"Subject: {subject}." if subject else "", statement]
        if excerpt:
            parts.append(f"Evidence excerpt: {excerpt}")
        parts.append(f"Source: {locator}")
        text = " ".join(p for p in parts if p)
        documents.append(
            {
                "workspaceId": ws,
                "title": f"{provenance.get('verb', 'CLAIM')} · {subject}"[:200],
                "text": text,
                "source": "ri-ledger-sourced-claims",
                "metadata": {
                    "claimId": row.get("claimId"),
                    "verb": provenance.get("verb"),
                    "subject": subject,
                    "locator": locator,
                    "validFrom": row.get("validFrom"),
                    "contentHash": hashlib.sha256(text.encode()).hexdigest(),
                },
            }
        )

    if args.limit:
        documents = documents[: args.limit]

    print(json.dumps({
        "sourced_claims_in_ledger": len(rows),
        "documents_to_ingest": len(documents),
        "mode": "apply" if args.apply else "dry-run",
    }, indent=2))

    if not args.apply:
        for doc in documents[:5]:
            print(" -", doc["title"], "|", doc["text"][:120])
        return 0

    created = 0
    for doc in documents:
        result = api("/api/rag/documents", doc, base, key)
        if result.get("created"):
            created += 1
    print(json.dumps({"ingested": len(documents), "created": created}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
