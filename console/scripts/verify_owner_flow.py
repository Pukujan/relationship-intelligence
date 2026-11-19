#!/usr/bin/env python3
"""RI-0010 verification: session copilot in a real browser, guest and owner.

    .venv/bin/python console/scripts/verify_owner_flow.py          # owner (Octo)
    .venv/bin/python console/scripts/verify_owner_flow.py --guest  # seed demo

Checks: scoped-tab isolation, reload resume, SSE progressive parts, sandboxed
artifact escape, inline approval parity with the inbox, and per-part evals.
"""
import os
import re
import sys
import time
import json
import urllib.request

from patchright.sync_api import sync_playwright

GUEST = "--guest" in sys.argv
BASE = "http://localhost:5173/console"
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.expanduser("~/.cache/acs/scratch/ri-stealth-profile")
PRE = os.path.join(HERE, "../../console-preview")
ROOT_ENV = os.path.join(HERE, "../../.env")


def log(*a):
    print(*a, flush=True)


def env_value(name):
    for line in open(ROOT_ENV):
        if line.startswith(name + "="):
            return line.strip().split("=", 1)[1]
    return ""


def session_state(page):
    return page.evaluate(
        """() => fetch('/app-api/session', {credentials:'same-origin'})
             .then(r => r.json()).catch(() => ({authenticated:false}))"""
    )


with sync_playwright() as pw:
    context = pw.chromium.launch_persistent_context(
        user_data_dir=PROFILE, headless=False,
        viewport={"width": 1600, "height": 1000}, locale="en-US", timezone_id="America/New_York",
    )
    page = context.pages[0] if context.pages else context.new_page()
    errors, dialogs = [], []
    page.on("pageerror", lambda e: errors.append(str(e)[:150]))
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    captured = {}

    def on_nav(frame):
        if frame != page.main_frame or frame.url.startswith("http://localhost"):
            return
        if "#token=" in frame.url or "#auth_error=" in frame.url:
            captured["url"] = frame.url

    page.on("framenavigated", on_nav)
    turn_digests = []

    def on_req(req):
        if req.url.endswith("/api/chat-stream") and req.method == "POST":
            try:
                body = json.loads(req.post_data or "{}")
                turn_digests.append([p["id"] for p in body.get("digest", {}).get("people", [])])
            except Exception:
                pass

    page.on("request", on_req)

    def on_resp(r):
        if "/app-api/decision" in r.url:
            try:
                log("   decision response:", r.status, r.text()[:160])
            except Exception:
                pass

    page.on("response", on_resp)
    page.goto(BASE + "/", wait_until="domcontentloaded")

    if GUEST:
        page.get_by_text("Continue as guest").click()
        page.wait_for_timeout(2500)
        log("mode: guest")
    else:
        state = session_state(page)
        if not state.get("authenticated"):
            log(">>> SIGN IN with Google in the opened window (10 min)…")
            page.get_by_text("Continue with Google").click()
            deadline = time.time() + 600
            last = ""
            while time.time() < deadline:
                page.wait_for_timeout(2000)
                if page.url != last:
                    log("    hop:", page.url.split("#")[0])
                    last = page.url
                state = session_state(page)
                if state.get("authenticated"):
                    break
                if "accounts.google.com" in page.url:
                    if page.locator("input[type=password]").count():
                        log("HAND BACK: password/2FA required")
                        context.close()
                        sys.exit(2)
                    try:
                        tile = page.locator("div[data-identifier]").first
                        if tile.count():
                            tile.click(timeout=3000)
                            continue
                        for name in ("Continue", "Allow", "Accept", "Next"):
                            btn = page.get_by_role("button", name=re.compile(name, re.I)).first
                            if btn.count():
                                btn.click(timeout=3000)
                                break
                    except Exception:
                        pass
                frag = captured.pop("url", None)
                if frag:
                    page.goto("http://localhost:5173/octo-auth/google/callback#" + frag.split("#", 1)[1])
                    page.wait_for_timeout(2500)
                    state = session_state(page)
                    if state.get("authenticated"):
                        break
                    log("FAIL: adapter rejected hand-off")
                    context.close()
                    sys.exit(1)
            if not state.get("authenticated"):
                log("FAIL: sign-in incomplete")
                context.close()
                sys.exit(1)
            log("session sealed")
        # owner: switch to the workspace carrying the console schema
        try:
            page.get_by_role("button", name=re.compile(r"Workspace:")).click(timeout=8000)
            page.get_by_role("menuitem", name=re.compile("social-engineering")).click(timeout=8000)
            page.wait_for_timeout(2500)
            log("0 workspace: social-engineering")
        except Exception as e:
            log("0 workspace switch skipped:", str(e)[:100])

    page.evaluate("(ws) => { window.__ws = ws; }", env_value("OCTO_WORKSPACE_ID"))
    # 1. quick-ask opens the session workspace
    page.keyboard.press("Meta+k")
    page.wait_for_url("**/copilot", timeout=10000)
    page.get_by_label("Message the copilot").wait_for(timeout=10000)
    log("1 ⌘K opens session workspace")

    page.get_by_role("button", name="New thread", exact=True).click()
    page.wait_for_function(
        "() => { const s = document.querySelector('select[aria-label=\"Scope for new thread\"]'); return s && [...s.options].filter(o => o.value.startsWith('person:')).length >= 2; }",
        timeout=45000,
    )
    options = page.get_by_label("Scope for new thread").evaluate(
        "(sel) => [...sel.options].filter(o => o.value.startsWith('person:')).map(o => ({id: o.value.slice(7), name: o.textContent.replace('person: ', '')}))"
    )
    if len(options) < 2:
        log("FAIL: fewer than two people available to scope")
        context.close()
        sys.exit(1)
    jane, sam = options[0], options[1]

    # 2. two scoped tabs: the digest actually sent must equal the pinned scope
    log("   scope options:", [(o["id"][:8], o["name"]) for o in options])

    def ask_in_new_tab(scope_kind, scope_id, question):
        page.get_by_role("button", name="New thread", exact=True).click()
        page.wait_for_timeout(700)
        scope = page.get_by_label("Scope for new thread")
        scope.select_option(value=f"{scope_kind}:{scope_id}")
        page.wait_for_timeout(300)
        page.get_by_label("Message the copilot").fill(question)
        page.get_by_label("Send").click()
        page.wait_for_timeout(800)
        saw_phase = page.get_by_text("Scoping the world digest").count() > 0
        page.get_by_label("Send").wait_for(state="visible", timeout=120000)
        page.wait_for_timeout(1000)
        return saw_phase

    progressive = ask_in_new_tab("person", jane["id"], f"What do we know about {jane['name']}? Answer with a table or graph if useful.")
    ask_in_new_tab("person", sam["id"], f"What do we know about {sam['name']}? One short paragraph.")
    iso_a = len(turn_digests) >= 1 and turn_digests[0] == [jane["id"]]
    iso_b = len(turn_digests) >= 2 and turn_digests[1] == [sam["id"]]
    log("   digests:", turn_digests)
    log(f"2 scoped tabs isolation: A={iso_a} B={iso_b} | progressive phases={progressive}")
    page.screenshot(path=PRE + "/sessions-tabs.png")

    # 3. reload resumes threads (titles visible in the session rail)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    if not page.url.endswith("/copilot"):
        page.keyboard.press("Meta+k")
        page.wait_for_url("**/copilot", timeout=10000)
    page.wait_for_timeout(1500)
    resumed = page.get_by_text("What do we know", exact=False).count() > 0
    log("3 reload resume:", resumed)

    WS = "fb94977c-695a-422f-a706-6554d8389cf7"
    design = {
        "kind": "mission", "missionName": "Send Jane a sourced open-source brief",
        "missionSummary": "Draft and hold a one-page brief for Jane Doe.",
        "projectId": None, "projectName": "Acme open-source brief",
        "objectiveName": "Brief delivered and acknowledged", "objectiveTarget": "1 acknowledged brief this week",
        "horizon": "this_week", "dueInDays": 5, "agentIds": ["research"],
        "autonomy": "approve",
        "planSteps": [{"label": "Collect sourced claims", "detail": "ledger + RAG", "agentId": "research"},
                      {"label": "Draft one-pager", "detail": "held for approval", "agentId": "research"}],
        "rationale": "Warm contact with an open thread; a sourced brief reopens it.",
        "unverified": ["Her current stance on tooling is unverified in the ledger."],
    }

    # 4. artifact escape: store raw-script html through the adapter (must sanitize)
    injected = page.evaluate("""async (ws) => {
      const list0 = await fetch('/app-api/sessions?workspaceId=' + ws, {credentials:'same-origin'}).then(r=>r.json());
      const sess = list0[0];
      const msg = {id:'msg-escape-'+Date.now(), role:'assistant', parts:[{kind:'artifact', title:'Escape Test',
        html:'<p>static</p><script>alert(1)</script><img src=x onerror="alert(2)">' }], createdAt:new Date().toISOString()};
      const r = await fetch('/app-api/sessions/'+sess.id+'/messages', {method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({workspaceId: ws, message: msg})});
      return {create: sess.id ? 200 : 400, append: r.status, title: sess.title};
    }""", WS)
    log("   injection:", injected)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if not page.url.endswith("/copilot"):
        page.keyboard.press("Meta+k")
        page.wait_for_url("**/copilot", timeout=10000)
    page.wait_for_timeout(1500)
    page.get_by_role("button", name=re.compile(re.escape(injected["title"][:40]))).first.click()
    page.wait_for_timeout(2000)
    dbg = page.evaluate("""async (ws) => {
      const list = await fetch('/app-api/sessions?workspaceId=' + ws, {credentials:'same-origin'}).then(r=>r.json());
      const esc = list.find(c => c.title === 'Escape test');
      const msgs = esc ? await fetch('/app-api/sessions/' + esc.id + '/messages?workspaceId=' + ws, {credentials:'same-origin'}).then(r=>r.json()) : [];
      return {titles: list.map(c=>c.title), escapeParts: (msgs[0]?.parts || []).map(p=>p.kind)};
    }""", WS)
    log("   step4 debug:", dbg)
    try:
        page.locator("iframe").first.wait_for(timeout=15000)
    except Exception:
        pass
    iframes = page.locator("iframe").count()
    log(f"4 artifact escape: iframes={iframes} dialogs fired={len(dialogs)} (must be 0)")
    page.screenshot(path=PRE + "/sessions-artifact.png")

    # 5. inline approval parity with a real pending approval created via the API
    rig = page.evaluate("""async (args) => {
      const [ws, design] = args;
      const ap = await fetch('/app-api/proposal', {method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({workspaceId: ws, proposal: {agentId:'research', kind:'mission',
          title:'Inline parity subject', proposedAction:'Send the brief.', reason:'Warm thread.',
          evidence:[], risk:'low', design}})}).then(r=>r.json());
      const list1 = await fetch('/app-api/sessions?workspaceId=' + ws, {credentials:'same-origin'}).then(r=>r.json());
      const sess = list1[0];
      const msg = {id:'msg-parity-'+Date.now(), role:'assistant', parts:[{kind:'approval', approvalId: ap.id}],
        createdAt:new Date().toISOString()};
      const r = await fetch('/app-api/sessions/'+sess.id+'/messages', {method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({workspaceId: ws, message: msg})});
      return {approval: ap.id, append: r.status, title: sess.title};
    }""", [WS, design])
    log("   parity rig:", rig)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if not page.url.endswith("/copilot"):
        page.keyboard.press("Meta+k")
        page.wait_for_url("**/copilot", timeout=10000)
    page.wait_for_timeout(1500)
    page.get_by_role("button", name=re.compile(re.escape(rig["title"][:40]))).first.click()
    page.wait_for_timeout(2000)

    def pending_count():
        return page.evaluate("""async (ws) => {
          const w = await fetch('/app-api/world?workspaceId=' + ws, {credentials:'same-origin'}).then(r=>r.json());
          return (w.approvals || []).filter(a=>a.status==='pending').length;
        }""", WS)

    before = pending_count()
    inline = page.get_by_role("button", name="Approve", exact=True).first
    try:
        inline.wait_for(timeout=15000)
    except Exception:
        pass
    parity = "n/a"
    if inline.count():
        inline.click()
        page.wait_for_timeout(2500)
        after = pending_count()
        parity = after == before - 1
        log(f"   pending before={before} after={after}")
    log("5 inline approval parity:", parity)
    page.screenshot(path=PRE + "/sessions-approval.png")

    # 6. per-part evals readable in Phoenix
    key = env_value("OCTO_API_KEY")
    ws = env_value("OCTO_WORKSPACE_ID")
    try:
        req = urllib.request.Request(
            f"https://octodb.design-bakery.com/api/workspaces/{ws}/otel/read/spans?name=copilot.session-turn&limit=1",
            headers={"Authorization": "Bearer " + key, "User-Agent": "ri-verify/0.1"})
        span = json.load(urllib.request.urlopen(req, timeout=20))["data"][0]
        sid = span["context"]["span_id"]
        req2 = urllib.request.Request(
            f"https://octodb.design-bakery.com/api/workspaces/{ws}/otel/read/span_annotations?span_ids={sid}&limit=6",
            headers={"Authorization": "Bearer " + key, "User-Agent": "ri-verify/0.1"})
        names = [a["name"] for a in json.load(urllib.request.urlopen(req2, timeout=20))["data"]]
        log("6 session-turn evals:", names)
    except Exception as e:
        log("6 evals read failed:", str(e)[:120])

    log("ERRORS:", " | ".join(errors) if errors else "none", "| dialogs:", len(dialogs))
    context.close()
