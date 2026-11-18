#!/usr/bin/env python3
"""Validate the planning/issue baseline without requiring application dependencies."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".github/scripts"))

from oio_installer import validate_project_ontology  # noqa: E402
from oio_triage import classify_issue  # noqa: E402


def main() -> int:
    required = [
        "PROJECT.md",
        "HANDOFF.md",
        "docs/PLAN.md",
        "docs/STACK.md",
        "docs/VALIDATION.md",
        "docs/SLICES.md",
        "docs/ISSUES.md",
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        print("Missing required project contracts:", ", ".join(missing), file=sys.stderr)
        return 1

    ontology = ROOT / ".oio/ontology/project.json"
    schema = ROOT / ".oio/schemas/v1/project-ontology.schema.json"
    default = ROOT / ".oio/ontology/default.json"
    import json

    validate_project_ontology(
        json.loads(ontology.read_text()), schema, json.loads(default.read_text())
    )

    failures = 0
    for path in sorted((ROOT / "docs/issues").glob("RI-*.md")):
        issue = {
            "body": path.read_text(),
            "labels": [],
            "user": {"id": 137629468, "login": "Pukujan"},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        result = classify_issue(issue, ROOT, "Pukujan/relationship-intelligence")
        # This warning is expected locally: account attestation is a GitHub label
        # event, not something a source file can manufacture.
        unexpected = [
            warning
            for warning in result["warnings"]
            if warning != "human-via-agent-origin-needs-direct-github-attestation"
        ]
        if unexpected:
            failures += 1
            print(f"{path.name}: {', '.join(unexpected)}", file=sys.stderr)
        else:
            print(f"VALID {path.name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
