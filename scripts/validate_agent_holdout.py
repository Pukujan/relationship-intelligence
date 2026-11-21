#!/usr/bin/env python3
"""Live hidden holdout for RI-0022 autonomous execution (read-only).

Frozen criteria (docs/issues/RI-0022.md):
  H1 no delivery without an approved decision;
  H3 failed runs leave a failed receipt;
  H5 receipts stay inside their workspace.

Runs against production Octo with a workspace key. Skips (exit 0) when no
executor runs exist yet; fails loudly on any invariant violation.

    OCTO_API_URL=... OCTO_API_KEY=... OCTO_WORKSPACE_ID=... \
        python3 scripts/validate_agent_holdout.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

BASE = os.environ.get("OCTO_API_URL", "").rstrip("/")
KEY = os.environ.get("OCTO_API_KEY", "")
WS = os.environ.get("OCTO_WORKSPACE_ID", "")


def sql(statement: str) -> list[dict]:
    req = urllib.request.Request(
        f"{BASE}/api/workspaces/{WS}/query",
        data=json.dumps({"sql": statement}).encode(),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "User-Agent": "ri-agent-holdout/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read()).get("rows", [])


def main() -> int:
    if not (BASE and KEY and WS):
        print("SKIP: set OCTO_API_URL, OCTO_API_KEY, OCTO_WORKSPACE_ID")
        return 0
    runs = sql(
        "SELECT id, workspace_id, doc FROM ri_console.agent_run "
        f"WHERE workspace_id = '{WS}' ORDER BY updated_at DESC LIMIT 100"
    )
    if not runs:
        print("SKIP: no agent runs recorded yet")
        return 0
    failures = 0
    trace_ids = set()
    for row in runs:
        doc = row["doc"] if isinstance(row["doc"], dict) else json.loads(row["doc"])
        rid = row["id"]
        if row["workspace_id"] != WS:
            print(f"RED H5 {rid}: receipt outside workspace")
            failures += 1
        outcome = doc.get("outcome")
        if outcome not in {"success", "partial", "escalated", "failed"}:
            print(f"RED {rid}: invalid outcome {outcome!r}")
            failures += 1
        trace = str(doc.get("traceId", ""))
        if doc.get("status") == "done" and not re.fullmatch(r"[0-9a-f]{32}", trace):
            print(f"RED {rid}: finished receipt without a W3C traceId")
            failures += 1
        if outcome == "failed":
            counts = doc.get("counts") or {}
            if any(counts.get(k, 0) for k in ("notes", "approvals", "drafts")):
                print(f"RED H3 {rid}: failed receipt claims writes")
                failures += 1
        trace_ids.add(trace)
    events = sql(
        "SELECT event_type, entity_id, trace_id FROM ri_console.ledger_event "
        f"WHERE workspace_id = '{WS}' AND event_type LIKE 'approval.%' "
        "ORDER BY created_at ASC LIMIT 1000"
    )
    approved: set[str] = set()
    for ev in events:
        if ev["event_type"] == "approval.approved":
            approved.add(str(ev["entity_id"]))
        if ev["event_type"] == "approval.delivered":
            if str(ev["entity_id"]) not in approved:
                print(f"RED H1: delivery without approval for {ev['entity_id']}")
                failures += 1
    finished = sql(
        "SELECT trace_id FROM ri_console.ledger_event "
        f"WHERE workspace_id = '{WS}' AND event_type = 'agent.run.finished' LIMIT 100"
    )
    for ev in finished:
        if str(ev["trace_id"]) not in trace_ids:
            print(f"RED: ledger run event without receipt trace {ev['trace_id']}")
            failures += 1
    print(f"{len(runs)} receipts, {len(finished)} run events, {len(approved)} approvals checked")
    if failures:
        print(f"{failures} holdout violation(s)")
        return 1
    print("GREEN: live agent-execution holdout passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
