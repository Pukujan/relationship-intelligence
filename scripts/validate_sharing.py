#!/usr/bin/env python3
"""Hold-out sharing validation: several accounts in one workspace (#62, #49).

Answers one question with observed HTTP results: when the owner invites people
into a workspace, who can see what? It uses only public HTTP routes of a LOCAL
adapter, plus the workspace SQL surface for setup and cleanup. It never imports
product code.

Accounts are test principals in principalId mode, the mode the Google sign-in
flow produces. Their session cookies are sealed with the local
SESSION_PASSWORD, so this runs only against localhost. Two things the real
flow does are emulated with SQL, and are therefore NOT covered here: creating a
person's first workspace, and activating a pending invite on first sign-in.

Everything lives in two throwaway workspaces named "holdout … <stamp>", and is
deleted at the end unless --keep is passed.

    python3 scripts/validate_sharing.py [--base http://127.0.0.1:8790] [--keep]

Exit 1 if any relation is RED.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def env_value(name):
    for path in (os.path.join(ROOT, "app", ".env"), os.path.join(ROOT, ".env")):
        try:
            for line in open(path):
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            continue
    return os.environ.get(name, "")


parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:8790")
parser.add_argument("--keep", action="store_true", help="leave the test rows in place")
args = parser.parse_args()
BASE = args.base.rstrip("/")
if not BASE.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("refusing to run: test sessions are sealed for a local adapter only")

OCTO = env_value("OCTO_API_URL") or "https://octodb.design-bakery.com"
CONTAINER = env_value("OCTO_WORKSPACE_ID")
KEY = env_value("OCTO_API_KEY")
STAMP = str(int(time.time()))
W = str(uuid.uuid4())             # the shared workspace
W2 = str(uuid.uuid4())            # a second tenant nobody from W belongs to
results = []


def sql(statement):
    req = urllib.request.Request(
        f"{OCTO}/api/workspaces/{CONTAINER}/query",
        data=json.dumps({"sql": statement}).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}",
                 "User-Agent": "ri-sharing-holdout/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("rows", [])


def seal(people):
    """Seal one principalId-mode session per person with the local password."""
    helper = os.path.join(ROOT, "app", f".seal-holdout-{STAMP}.mts")
    with open(helper, "w") as f:
        f.write(
            'import { sealData } from "iron-session";\n'
            "const people = JSON.parse(process.argv[2]);\n"
            "const out: Record<string, string> = {};\n"
            "for (const p of people) out[p.key] = await sealData(\n"
            "  { principalId: p.id, email: p.email, displayName: p.name, lastSeenAt: Date.now() },\n"
            '  { password: process.env.SESSION_PASSWORD ?? "" });\n'
            "process.stdout.write(JSON.stringify(out));\n"
        )
    try:
        out = subprocess.run(
            [os.path.join(ROOT, "app", "node_modules", ".bin", "tsx"),
             "--env-file-if-exists=.env", helper, json.dumps(people)],
            cwd=os.path.join(ROOT, "app"), capture_output=True, text=True, timeout=60,
        )
        return json.loads(out.stdout)
    finally:
        os.remove(helper)


def call(cookie, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if cookie:
        req.add_header("Cookie", f"ri_session={cookie}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def record(name, claim, expected, actual, ok):
    results.append((name, "PASS" if ok else "RED"))
    print(f"{name:4} {'PASS' if ok else 'RED ':4} expected={expected} actual={actual}  ({claim})")


def project_names(body):
    return sorted(p.get("name", "") for p in body.get("projects", []))


people = [
    {"key": k, "id": str(uuid.uuid4()), "email": f"holdout-{k}-{STAMP}@example.test",
     "name": f"Holdout {k.upper()}"}
    for k in ("owner", "a", "b", "c", "other")
]
by = {p["key"]: p for p in people}
jar = seal(people)


def lit(value):
    return "'" + str(value).replace("'", "''") + "'"


def cleanup():
    tables = ["project", "objective", "mission", "plan", "agent", "agent_task", "agent_run",
              "approval", "activity", "conversation", "note", "ledger_event"]
    for table in tables:
        try:
            sql(f"DELETE FROM ri_console.{table} WHERE workspace_id IN ({lit(W)}, {lit(W2)})")
        except Exception:
            pass
    sql(f"DELETE FROM ri_console.workspace_member WHERE workspace_id IN ({lit(W)}, {lit(W2)})")
    sql(f"DELETE FROM ri_console.workspace WHERE id IN ({lit(W)}, {lit(W2)})")
    sql(f"DELETE FROM ri_console.app_user WHERE email LIKE {lit('holdout-%-' + STAMP + '@example.test')}")


try:
    # Setup the real flow does on first sign-in: a workspace and its owner.
    for ws, owner_key in ((W, "owner"), (W2, "other")):
        o = by[owner_key]
        sql(f"INSERT INTO ri_console.workspace (id, name, slug, kind, created_by) "
            f"VALUES ({lit(ws)}, {lit('holdout ' + owner_key + ' ' + STAMP)}, {lit('holdout-' + owner_key + '-' + STAMP)}, 'team', {lit(o['id'])})")
        sql(f"INSERT INTO ri_console.workspace_member (workspace_id, email, principal_id, display_name, role, status) "
            f"VALUES ({lit(ws)}, {lit(o['email'])}, {lit(o['id'])}, {lit(o['name'])}, 'owner', 'active')")

    # S1: the owner invites A and B through the product's own route.
    codes = [call(jar["owner"], "POST", f"/app-api/workspaces/{W}/invites",
                  {"email": by[k]["email"], "role": "member"})[0] for k in ("a", "b")]
    record("S1", "owner can invite", [200, 200], codes, codes == [200, 200])

    # S2: an invite that has not been accepted grants nothing.
    s, _ = call(jar["a"], "GET", f"/app-api/world?workspaceId={W}")
    record("S2", "pending invite grants no access", 403, s, s == 403)

    # Emulate first sign-in, which binds the principal and activates the invite.
    for k in ("a", "b"):
        sql(f"UPDATE ri_console.workspace_member SET status = 'active', principal_id = {lit(by[k]['id'])} "
            f"WHERE workspace_id = {lit(W)} AND email = {lit(by[k]['email'])}")

    # S3: members get in; a signed-in outsider does not.
    codes = {k: call(jar[k], "GET", f"/app-api/world?workspaceId={W}")[0] for k in ("owner", "a", "b", "c")}
    record("S3", "members read the workspace, an outsider cannot",
           {"owner": 200, "a": 200, "b": 200, "c": 403}, codes,
           codes == {"owner": 200, "a": 200, "b": 200, "c": 403})

    # S4: a project the owner creates is shared with every member.
    s, p = call(jar["owner"], "POST", "/app-api/projects", {"workspaceId": W, "name": f"shared-{STAMP}"})
    pid = p.get("id", "")
    seen = {k: f"shared-{STAMP}" in project_names(call(jar[k], "GET", f"/app-api/world?workspaceId={W}")[1])
            for k in ("a", "b")}
    record("S4", "a shared project is visible to both members", {"a": True, "b": True}, seen,
           s == 200 and seen == {"a": True, "b": True})

    # S5 (metamorphic): two members with the same role see the same shared projects.
    pa = project_names(call(jar["a"], "GET", f"/app-api/world?workspaceId={W}")[1])
    pb = project_names(call(jar["b"], "GET", f"/app-api/world?workspaceId={W}")[1])
    record("S5", "swapping A and B does not change what is shared", pa, pb, pa == pb)

    # S6: a private row stays with its author.
    s, conv = call(jar["a"], "POST", "/app-api/sessions",
                   {"workspaceId": W, "title": f"private-{STAMP}", "scopeKind": "workspace"})
    cid = conv.get("id", "")

    def conversation_ids(k):
        body = call(jar[k], "GET", f"/app-api/sessions?workspaceId={W}")[1]
        rows = body if isinstance(body, list) else body.get("sessions", [])
        return [c.get("id") for c in rows]

    mine, theirs, owners = cid in conversation_ids("a"), cid in conversation_ids("b"), cid in conversation_ids("owner")
    record("S6", "A's private conversation is visible to A only",
           {"a": True, "b": False, "owner": False}, {"a": mine, "b": theirs, "owner": owners},
           bool(cid) and mine and not theirs and not owners)

    # S7: a member cannot do admin things.
    s_inv, _ = call(jar["a"], "POST", f"/app-api/workspaces/{W}/invites",
                    {"email": f"holdout-x-{STAMP}@example.test", "role": "member"})
    s_rm, _ = call(jar["a"], "DELETE", f"/app-api/workspaces/{W}/members/{by['b']['email']}")
    record("S7", "a member cannot invite or remove people", [403, 403], [s_inv, s_rm],
           [s_inv, s_rm] == [403, 403])

    # S8: membership of W says nothing about another tenant.
    codes = {k: call(jar[k], "GET", f"/app-api/world?workspaceId={W2}")[0] for k in ("owner", "a", "b")}
    s_w, _ = call(jar["a"], "POST", "/app-api/projects", {"workspaceId": W2, "name": f"leak-{STAMP}"})
    record("S8", "no one from W can read or write the other workspace",
           {"owner": 403, "a": 403, "b": 403, "write": 403}, {**codes, "write": s_w},
           all(c == 403 for c in codes.values()) and s_w == 403)

    # S9: the session only lists workspaces the person belongs to.
    s, sess = call(jar["a"], "GET", "/app-api/session")
    listed = sorted(w.get("id") for w in sess.get("workspaces", []))
    record("S9", "A's workspace list is exactly its memberships", [W], listed, listed == [W])

    # S10: the copilot spends the owner's model keys, so an account that
    # belongs to no workspace must not reach it.
    s_c, _ = call(jar["c"], "GET", "/api/models")
    s_a, _ = call(jar["a"], "GET", "/api/models")
    record("S10", "the copilot is closed to an account with no workspace",
           {"outsider": 403, "member": "200 (or 502 if the copilot server is not running)"},
           {"outsider": s_c, "member": s_a}, s_c == 403 and s_a in (200, 502))

    # S12: notes. A shared note reaches the other member, a private one does
    # not, and neither crosses into the other workspace.
    def note_titles(k, ws):
        body = call(jar[k], "GET", f"/app-api/notes?workspaceId={ws}")[1]
        return sorted(n.get("title", "") for n in (body if isinstance(body, list) else []))

    s_sh, sh_body = call(jar["a"], "POST", "/app-api/notes",
                   {"workspaceId": W, "title": f"shared-note-{STAMP}", "body": "x", "visibility": "shared"})
    s_pr, _ = call(jar["a"], "POST", "/app-api/notes",
                   {"workspaceId": W, "title": f"private-note-{STAMP}", "body": "x", "visibility": "private"})
    if s_sh != 200:
        print("   S12 create answered", s_sh, json.dumps(sh_body)[:240])
    raw = call(jar["a"], "GET", f"/app-api/notes?workspaceId={W}")
    if not isinstance(raw[1], list):
        print("   S12 list answered", raw[0], json.dumps(raw[1])[:240])
    got = {"a": note_titles("a", W), "b": note_titles("b", W), "other tenant": note_titles("other", W2)}
    want = {"a": [f"private-note-{STAMP}", f"shared-note-{STAMP}"], "b": [f"shared-note-{STAMP}"],
            "other tenant": []}
    record("S12", "a shared note is shared, a private note is not, neither leaves the workspace",
           want, got, [s_sh, s_pr] == [200, 200] and got == want)

    # S13: a real Octo guest. Octo mints a guest for anyone who asks and gives
    # it a personal workspace, so it "belongs to a workspace" without belonging
    # to this app. It must not reach the copilot.
    try:
        req = urllib.request.Request(f"{OCTO}/api/auth/guest", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "ri-sharing-holdout/1.0"})
        guest_token = json.loads(urllib.request.urlopen(req, timeout=30).read()).get("sessionToken", "")
    except Exception:
        guest_token = ""
    if guest_token:
        jar_req = urllib.request.Request(BASE + "/app-api/session/accept",
                                         data=json.dumps({"token": guest_token}).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(jar_req, timeout=30) as r:
            guest_cookie = (r.headers.get("Set-Cookie") or "").split("ri_session=", 1)[-1].split(";", 1)[0]
        s_g, _ = call(guest_cookie, "GET", "/api/models")
        s_gp, _ = call(guest_cookie, "POST", "/api/copilot", {"prompt": "hi", "digest": {}})
        record("S13", "an Octo guest with its own workspace cannot reach the copilot",
               [403, 403], [s_g, s_gp], [s_g, s_gp] == [403, 403])
    else:
        record("S13", "an Octo guest with its own workspace cannot reach the copilot",
               [403, 403], "could not mint a guest", False)

    # S14 (#73): canonical people and private imported notes must stay scoped
    # to their owning workspace and never leak into other workspaces.
    w_people = {
        k: len(call(jar[k], "GET", f"/app-api/world?workspaceId={W}")[1].get("people", []))
        for k in ("owner", "a", "b")
    }
    w2_people = len(call(jar["other"], "GET", f"/app-api/world?workspaceId={W2}")[1].get("people", []))
    got_people = {**w_people, "other": w2_people}
    want_people = {"owner": 0, "a": 0, "b": 0, "other": 0}
    record("S14", "imported private people do not leak into other workspaces (#73)",
           want_people, got_people, got_people == want_people)

    # S11: removing a member takes effect on the very next request.
    s_rm, _ = call(jar["owner"], "DELETE", f"/app-api/workspaces/{W}/members/{by['b']['email']}")
    s_after, _ = call(jar["b"], "GET", f"/app-api/world?workspaceId={W}")
    s_a_still, _ = call(jar["a"], "GET", f"/app-api/world?workspaceId={W}")
    record("S11", "a removed member loses access at once, others keep it",
           {"remove": 200, "b": 403, "a": 200}, {"remove": s_rm, "b": s_after, "a": s_a_still},
           s_rm == 200 and s_after == 403 and s_a_still == 200)
finally:
    if args.keep:
        print(f"\nkept test workspaces {W} and {W2}")
    else:
        cleanup()

red = [name for name, state in results if state == "RED"]
print(f"\n{len(results)} relations: {len(results) - len(red)} pass, {len(red)} red")
sys.exit(1 if red else 0)
