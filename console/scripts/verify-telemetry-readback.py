#!/usr/bin/env python3
"""Read back a span and attach an eval score through Octo MCP.

Usage: python3 scripts/verify-telemetry-readback.py <trace_id> <span_id>

Proves hops 2 and 3 of the telemetry chain: read_traces returns the exported
span, and record_eval_scores attaches a score that span_annotations returns.
Reads OCTO_* from the repo root .env (or the environment).
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def read_env(file):
    if not os.path.exists(file):
        return {}
    out = {}
    for line in open(file):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


env = {
    **read_env(os.path.join(HERE, "../../.env")),
    **read_env(os.path.join(HERE, "../.env")),
    **os.environ,
}
BASE = env.get("OCTO_API_URL", "").rstrip("/")
KEY = env.get("OCTO_API_KEY", "")
WS = env.get("OCTO_WORKSPACE_ID", "")
if not BASE or not KEY or not WS:
    sys.exit("set OCTO_API_URL, OCTO_API_KEY and OCTO_WORKSPACE_ID")
if len(sys.argv) != 3:
    sys.exit(__doc__)
trace_id, span_id = sys.argv[1], sys.argv[2]


def rpc(method, params=None, sid=None, rid=1):
    body = {"jsonrpc": "2.0", "method": method}
    if not method.startswith("notifications/"):
        body["id"] = rid
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        BASE + "/mcp",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + KEY,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "ri-console/0.1",
        },
    )
    if sid:
        req.add_header("mcp-session-id", sid)
    resp = urllib.request.urlopen(req, timeout=40)
    sid2 = resp.headers.get("mcp-session-id") or sid
    raw = resp.read().decode()
    if "data:" in raw[:200]:
        payloads = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
        data = json.loads(payloads[-1]) if payloads else {}
    else:
        data = json.loads(raw) if raw.strip() else {}
    return data, sid2


_, sid = rpc("initialize", {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {"name": "ri-console-verify", "version": "0.1"},
})
rd, sid = rpc("tools/call", {
    "name": "read_traces",
    "arguments": {"workspaceId": WS, "resource": "spans", "query": {"trace_id": trace_id, "limit": 5}},
}, sid, 2)
spans_text = rd.get("result", {}).get("content", [{}])[0].get("text", "")
print("READ_TRACES:", spans_text[:500])
if span_id not in spans_text:
    sys.exit("span not found in Phoenix — export hop failed")

ev, sid = rpc("tools/call", {
    "name": "record_eval_scores",
    "arguments": {"workspaceId": WS, "scores": [{
        "span_id": span_id,
        "name": "groundedness",
        "annotator_kind": "CODE",
        "result": {
            "score": 1.0,
            "label": "pass",
            "explanation": "telemetry chain verification",
        },
    }]},
}, sid, 3)
print("RECORD_EVAL:", json.dumps(ev)[:300])

an, sid = rpc("tools/call", {
    "name": "read_traces",
    "arguments": {"workspaceId": WS, "resource": "span_annotations", "query": {"span_ids": span_id, "limit": 5}},
}, sid, 4)
ann_text = an.get("result", {}).get("content", [{}])[0].get("text", "")
print("ANNOTATIONS:", ann_text[:400])
if "groundedness" not in ann_text:
    sys.exit("eval score not attached — eval hop failed")
print("CHAIN OK: export -> read_traces -> record_eval_scores -> span_annotations")
