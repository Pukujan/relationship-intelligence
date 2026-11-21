#!/usr/bin/env python3
"""Upload raw source bytes to Octo Files for evidence-backed claims.

PROJECT.md:36 says canonical source bytes live in Octo Files; docs/PLAN.md:162
says raw documents go there before extraction. This script uploads files from
a local directory (HTML, PDFs, screenshots, exports) with their content hash
and source metadata, so later claims can cite a real file id rather than a bare
URL. It is idempotent: files with the same name + content hash are skipped.

There is deliberately no bundled source material in this repository. Point
--dir at the raw capture directory produced by your connector/importer.

Dry run by default; --apply writes.

Usage:
    python3 scripts/seed_files.py --dir ~/.cache/acs/sources
    python3 scripts/seed_files.py --dir ~/.cache/acs/sources --apply
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "__pycache__", "dist"}


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
            "User-Agent": "ri-seed-files/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="directory of raw source files")
    parser.add_argument("--apply", action="store_true", help="upload files")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    base = env_value("OCTO_API_URL").rstrip("/")
    key = env_value("OCTO_API_KEY")
    ws = env_value("OCTO_WORKSPACE_ID")
    if not base or not key or not ws:
        print("missing OCTO_API_URL / OCTO_API_KEY / OCTO_WORKSPACE_ID", file=sys.stderr)
        return 2

    source_dir = Path(os.path.expanduser(args.dir)).resolve()
    if not source_dir.is_dir():
        print(f"not a directory: {source_dir}", file=sys.stderr)
        return 2

    existing = api("/api/files?workspaceId=" + ws, None, base, key)
    existing_hashes = {
        str((row.get("metadata") or {}).get("contentHash"))
        for row in existing
        if isinstance(row, dict) and isinstance(row.get("metadata"), dict)
    }

    candidates = []
    for path in sorted(source_dir.rglob("*")):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
            continue
        data = path.read_bytes()
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        if digest in existing_hashes:
            continue
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        candidates.append((path, data, digest, mime))

    if args.limit:
        candidates = candidates[: args.limit]

    print(json.dumps({
        "source_dir": str(source_dir),
        "files_already_in_octo": len(existing),
        "files_to_upload": len(candidates),
        "mode": "apply" if args.apply else "dry-run",
    }, indent=2))
    for path, _data, digest, mime in candidates[:8]:
        print(" -", path.name, "|", mime, "|", digest[:20])

    if not args.apply:
        return 0

    uploaded = 0
    for path, data, digest, mime in candidates:
        name = str(path.relative_to(source_dir))
        body = {
            "workspaceId": ws,
            "name": name,
            "mimeType": mime,
            "data": base64.b64encode(data).decode("ascii"),
            "dataEncoding": "base64",
            "metadata": {
                "contentHash": digest,
                "sourcePath": str(path),
                "ingestedBy": "ri-seed-files",
            },
        }
        api("/api/files/upload", body, base, key)
        uploaded += 1
    print(json.dumps({"uploaded": uploaded}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
