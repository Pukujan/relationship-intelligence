#!/usr/bin/env python3
"""
Run queries from queries/social.cypher against the workspace graph.

    python queries/run.py 3 --param personName="Jane Doe"
    python queries/run.py 1 --param meName="Sam Rivera" --param targetName="Jane Doe"
    python queries/run.py --file queries/social.cypher --list
    python queries/run.py 3 --param personName="Jane Doe" --sql   # ad-hoc query instead

Query text lives in social.cypher as `// N. TITLE` headers. Params are
--param name=value (strings); numbers are coerced when they look numeric.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def parse_queries(path: str) -> dict[int, dict]:
    """Split the .cypher file into numbered queries on their `// N. Title` headers."""
    with open(path) as fh:
        lines = fh.read().splitlines()

    queries: dict[int, dict] = {}
    cur_num: int | None = None
    cur_title = ""
    cur_body: list[str] = []
    cur_params: list[str] = []

    def flush() -> None:
        if cur_num is not None:
            body = "\n".join(cur_body).strip().rstrip(";").strip()
            if body:
                queries[cur_num] = {"title": cur_title, "body": body, "params": cur_params}

    for line in lines:
        header = re.match(r"^//\s*(\d+)\.\s+(.*)$", line.strip())
        params = re.match(r"^//\s*params:\s*(.*)$", line.strip())
        if header:
            flush()
            cur_num = int(header.group(1))
            cur_title = header.group(2)
            cur_body, cur_params = [], []
            continue
        if params and cur_num is not None:
            found = re.findall(r"\$(\w+)", params.group(1))
            cur_params.extend(found)
            continue
        if line.strip().startswith("//"):
            continue
        if cur_num is not None:
            cur_body.append(line)
    flush()
    return queries


def api(path: str, body: dict) -> dict:
    base = os.environ.get("OCTO_API_URL", "").rstrip("/")
    key = os.environ.get("OCTO_API_KEY", "")
    if not (base and key):
        sys.exit("set OCTO_API_URL and OCTO_API_KEY (see .env.example)")
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "social-graph-loader/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Octo {e.code} on {path}: {e.read().decode()[:600]}") from None


def coerce(value: str):
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("number", nargs="?", type=int)
    ap.add_argument("--file", default=os.path.join(HERE, "social.cypher"))
    ap.add_argument("--param", action="append", default=[],
                    help="name=value (repeatable)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--json", action="store_true", help="raw JSON output")
    ap.add_argument("--days", type=int, help="compute $cutoff as now - N days (query 7)")
    args = ap.parse_args()

    queries = parse_queries(args.file)

    if args.list or args.number is None:
        for n in sorted(queries):
            q = queries[n]
            need = f" params: {', '.join(sorted(set(q['params'])))}" if q["params"] else ""
            print(f"{n:2}. {q['title']}{need}")
        return

    if args.number not in queries:
        sys.exit(f"no query {args.number}; use --list")

    params: dict = {}
    if args.days is not None:
        from datetime import datetime, timedelta, timezone
        params["cutoff"] = (datetime.now(timezone.utc) - timedelta(days=args.days)) \
            .strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in args.param:
        if "=" not in p:
            sys.exit(f"--param needs name=value, got {p!r}")
        k, v = p.split("=", 1)
        params[k] = coerce(v)

    q = queries[args.number]
    missing = [p for p in set(q["params"]) if p not in params]
    if missing:
        sys.exit(f"query {args.number} needs params: {', '.join(missing)}")

    res = api("/api/graph/query", {
        "workspaceId": os.environ["OCTO_WORKSPACE_ID"],
        "query": q["body"],
        "params": params,
    })

    if args.json:
        print(json.dumps(res, indent=2))
        return

    rows = res.get("rows", [])
    if not rows:
        print(f"(no rows)  — {q['title']}")
        return
    print(f"{q['title']}  ({len(rows)} rows)\n")
    cols = list(rows[0].keys()) if isinstance(rows[0], dict) else []
    widths = {c: min(46, max(len(c), max(len(str(r.get(c, ""))) for r in rows))) for c in cols}
    print("  ".join(c.ljust(widths[c]) for c in cols))
    print("  ".join("-" * widths[c] for c in cols))
    for r in rows:
        print("  ".join(str(r.get(c, ""))[:widths[c]].ljust(widths[c]) for c in cols))


if __name__ == "__main__":
    main()
