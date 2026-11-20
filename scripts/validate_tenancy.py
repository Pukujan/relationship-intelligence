#!/usr/bin/env python3
"""Hold-out tenancy/role validation (RI-0017). Written BEFORE implementation.

Uses only public HTTP surfaces (plus the workspace SQL surface for cascade
assertions). Never imports product code. Two real sessions: owner (workspace
key via accept-key) and an Octo guest principal (no membership anywhere).

Exit 1 if any metamorphic relation is RED. SKIPs are reported, not failures.
See docs/VALIDATIONS-WORKSPACES-ROLES.md for the relation table and baseline.
"""
import json
import os
import re
import sys
import time
import urllib.request
import http.cookiejar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def env_value(name):
    for path in (os.path.join(ROOT, ".env"), os.path.join(ROOT, "app", ".env")):
        try:
            for line in open(path):
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            continue
    return os.environ.get(name, "")


BASE = env_value("RI_PUBLIC_URL") or "https://business.design-bakery.com"
OCTO = env_value("OCTO_API_URL") or "https://octodb.design-bakery.com"
WS = env_value("OCTO_WORKSPACE_ID")
KEY = env_value("OCTO_API_KEY")
STAMP = str(int(time.time()))
results = []


def call(jar, method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ri-holdout/1.0")
    if data:
        req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def sql(statement):
    status, body = call(
        http.cookiejar.CookieJar(), "POST",
        f"{OCTO}/api/workspaces/{WS}/query", {"sql": statement},
    )
    # the SQL surface authenticates by header, not cookie
    req = urllib.request.Request(
        f"{OCTO}/api/workspaces/{WS}/query",
        data=json.dumps({"sql": statement}).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}",
                 "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ri-holdout/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def record(mr, invariant, expected, actual, ok, skip=False):
    state = "SKIP" if skip else ("PASS" if ok else "RED")
    results.append((mr, state))
    print(f"{mr} {state:4} expected={expected} actual={actual}  ({invariant})")


owner = http.cookiejar.CookieJar()
guest = http.cookiejar.CookieJar()
s, _ = call(owner, "POST", f"{BASE}/app-api/session/accept-key", {"key": KEY})
assert s == 200, f"owner accept-key failed: {s}"
s, g = call(http.cookiejar.CookieJar(), "POST", f"{OCTO}/api/auth/guest", {})
assert s in (200, 201), f"guest mint failed: {s}"
s, _ = call(guest, "POST", f"{BASE}/app-api/session/accept", {"token": g["sessionToken"]})
assert s == 200, f"guest accept failed: {s}"

# MR1 — foreign workspace read must 403 for a non-member
s, b = call(guest, "GET", f"{BASE}/app-api/world?workspaceId={WS}")
record("MR1", "I1", 403, s, s == 403)

# MR2 — session workspace list must shrink to memberships
s, b = call(guest, "GET", f"{BASE}/app-api/session")
names = [w.get("id") for w in b.get("workspaces", [])]
record("MR2", "I1", "no foreign ws", names, WS not in names)

# MR3 — foreign write must 403
s, b = call(guest, "POST", f"{BASE}/app-api/projects",
            {"workspaceId": WS, "name": f"holdout-{STAMP}"})
record("MR3", "I1+roles", 403, s, s == 403)
sql(f"DELETE FROM ri_console.project WHERE doc->>'name' = 'holdout-{STAMP}'")

# MR1b/MR3b — the principalId-mode path (our own Google flow) uses the owner
# key server-side, so membership is checked against the KEY's workspaces, not
# the session principal's. Requires a second real Google identity; exercised
# by U4 in the patchright suite once invites exist.
record("MR1b", "I1 (principalId mode)", 403, "needs 2nd Google identity", False, skip=True)
record("MR3b", "I1+roles (principalId mode)", 403, "needs 2nd Google identity", False, skip=True)

# MR4 — invite must be role-gated (404 = unenforced = red)
s, b = call(guest, "POST", f"{BASE}/app-api/workspaces/{WS}/invites",
            {"email": f"holdout-{STAMP}@example.com", "role": "member"})
record("MR4", "roles", 403, s, s == 403)

# MR5 — workspace create/provision idempotence (needs account-scoped key)
record("MR5", "I4", "200+idempotent", "unconfigured", False,
       skip=not env_value("OCTO_ACCOUNT_KEY"))

# MR6 — cascade delete leaves no orphan children
s, p = call(owner, "POST", f"{BASE}/app-api/projects",
            {"workspaceId": WS, "name": f"holdout-cascade-{STAMP}"})
pid = p.get("id", "")
sql(f"INSERT INTO ri_console.mission (id, workspace_id, principal_id, visibility, doc) "
    f"VALUES ('holdout-m-{STAMP}', '{WS}', '0db36ada-53a3-454a-a18b-697220bb9cbc', 'shared', "
    f"'{{\"id\":\"holdout-m-{STAMP}\",\"projectId\":\"{pid}\",\"name\":\"holdout mission\"}}'::jsonb)")
s, _ = call(owner, "DELETE", f"{BASE}/app-api/projects/{pid}?workspaceId={WS}")
left = sql(f"SELECT count(*) AS n FROM ri_console.mission WHERE doc->>'projectId' = '{pid}'")
n = int(left["rows"][0]["n"])
record("MR6", "I5", 0, n, s == 200 and n == 0)
sql(f"DELETE FROM ri_console.mission WHERE id = 'holdout-m-{STAMP}'")

# MR7 — deciding twice materializes at most once
s, ap = call(owner, "POST", f"{BASE}/app-api/proposal", {
    "workspaceId": WS,
    "proposal": {"agentId": "research", "kind": "mission",
                 "title": f"holdout-approval-{STAMP}", "proposedAction": "x",
                 "reason": "hold-out", "evidence": [], "risk": "low",
                 "design": {"kind": "mission", "missionName": f"holdout-mission-{STAMP}",
                            "missionSummary": "x", "objectiveName": "o", "objectiveTarget": "t",
                            "horizon": "this_week", "dueInDays": 5, "agentIds": ["research"],
                            "autonomy": "approve", "planSteps": [{"label": "a", "detail": "b"}],
                            "rationale": "r", "unverified": []}}})
aid = ap.get("id", "")
s1, _ = call(owner, "POST", f"{BASE}/app-api/decision",
             {"workspaceId": WS, "approvalId": aid, "decision": "approved", "note": "hold-out"})
s2, _ = call(owner, "POST", f"{BASE}/app-api/decision",
             {"workspaceId": WS, "approvalId": aid, "decision": "approved", "note": "hold-out twice"})
cnt = sql(f"SELECT count(*) AS n FROM ri_console.mission WHERE doc->>'name' = 'holdout-mission-{STAMP}'")
n = int(cnt["rows"][0]["n"])
record("MR7", "I6", "<=1 mission", f"{s1}/{s2}, n={n}", n <= 1)
sql(f"DELETE FROM ri_console.mission WHERE doc->>'name' = 'holdout-mission-{STAMP}'")
sql(f"DELETE FROM ri_console.approval WHERE id = '{aid}'")

# MR8 — private rows invisible across principals
s, conv = call(owner, "POST", f"{BASE}/app-api/sessions",
               {"workspaceId": WS, "title": f"holdout-private-{STAMP}", "scopeKind": "workspace"})
cid = conv.get("id", "")
s, b = call(guest, "GET", f"{BASE}/app-api/sessions?workspaceId={WS}")
ids = [c.get("id") for c in (b if isinstance(b, list) else b.get("sessions", []))]
record("MR8", "I2", "owner private absent", cid in ids, cid not in ids)
sql(f"DELETE FROM ri_console.conversation WHERE id = '{cid}'")

# MR9 — role change takes effect next request (needs invite flow)
record("MR9", "I3", "immediate", "unimplemented", False, skip=True)

red = [mr for mr, state in results if state == "RED"]
print(f"\n{len(results)} relations: "
      f"{sum(1 for _, s in results if s == 'PASS')} pass, "
      f"{len(red)} red, {sum(1 for _, s in results if s == 'SKIP')} skip")
sys.exit(1 if red else 0)
