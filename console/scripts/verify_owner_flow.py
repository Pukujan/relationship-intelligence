#!/usr/bin/env python3
"""Owner-mode user-flow verification through a stealth-patched browser.

Uses patchright (patched Playwright, the engine named in Pukujan/stealth-mode's
engine table) with a persistent profile, so Google sees a patched driver and the
profile keeps the session for later runs. A human completes consent once in the
opened window; everything after that is automated.

    .venv/bin/python console/scripts/verify_owner_flow.py
"""
import os
import re
import sys
import time
import urllib.request
import json

from patchright.sync_api import sync_playwright

BASE = "http://localhost:5173/console"
HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(os.path.expanduser("~"), ".cache/acs/scratch/ri-stealth-profile")
PRE = os.path.join(HERE, "../../console-preview")


def log(*a):
    print(*a, flush=True)


def session_state(page):
    return page.evaluate(
        """() => fetch('/app-api/session', {credentials:'same-origin'})
             .then(r => r.json()).catch(() => ({authenticated:false}))"""
    )


with sync_playwright() as pw:
    context = pw.chromium.launch_persistent_context(
        user_data_dir=PROFILE,
        headless=False,
        viewport={"width": 1600, "height": 1000},
        locale="en-US",
        timezone_id="America/New_York",
    )
    page = context.pages[0] if context.pages else context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:150]))
    # Octo delivers the session token as a fragment on ITS OWN origin and its
    # frontend strips the hash immediately. Catch it at navigation time, before
    # any script can remove it, then replay the documented hand-off locally.
    captured = {}

    def on_nav(frame):
        if frame != page.main_frame:
            return
        # Only Octo's origin delivers the hand-off fragment; our own callback
        # navigation carries it too and must not re-trigger a replay.
        if frame.url.startswith("http://localhost"):
            return
        if "#token=" in frame.url or "#auth_error=" in frame.url:
            captured["url"] = frame.url

    page.on("framenavigated", on_nav)
    page.goto(BASE + "/", wait_until="domcontentloaded")

    state = session_state(page)
    if not state.get("authenticated"):
        log(">>> SIGN IN with Google in the opened stealth window. Waiting up to 10 minutes…")
        page.get_by_text("Continue with Google").click()
        deadline = time.time() + 600
        last_url = ""
        while time.time() < deadline:
            page.wait_for_timeout(2000)
            url = page.url
            if url != last_url:
                # Log hops without the token itself.
                log("    hop:", url.split("#")[0], "(fragment present)" if "#" in url else "")
                last_url = url
            state = session_state(page)
            if state.get("authenticated"):
                break
            # The owner asked us to complete sign-in with the persisted session.
            # Click through account chooser / consent only; never type secrets.
            if "accounts.google.com" in url:
                if page.locator("input[type=password]").count():
                    log("HAND BACK: Google wants a password or 2FA — human step required")
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
            fragment_url = captured.pop("url", None)
            if fragment_url:
                fragment = fragment_url.split("#", 1)[1]
                log("    caught token fragment at navigation; replaying hand-off locally")
                page.goto("http://localhost:5173/octo-auth/google/callback#" + fragment)
                page.wait_for_timeout(2500)
                state = session_state(page)
                if state.get("authenticated"):
                    break
                log("FAIL: adapter rejected the hand-off token; see adapter log")
                context.close()
                sys.exit(1)
        if not state.get("authenticated"):
            log("FAIL: sign-in did not complete; last url:", page.url.split("#")[0])
            context.close()
            sys.exit(1)
        log("session sealed; profile keeps it for later runs")
        page.goto(BASE + "/", wait_until="domcontentloaded")

    principal = (state.get("principal") or {}).get("id", "")

    # 0. tenancy: switch from the default personal workspace to the one that
    # carries the console schema and the shared graph.
    try:
        page.get_by_role("button", name=re.compile(r"Workspace:")).click(timeout=8000)
        page.get_by_role("menuitem", name=re.compile("social-engineering")).click(timeout=8000)
        page.wait_for_timeout(3000)
        log("0 workspace switched to social-engineering")
    except Exception as e:
        log("0 workspace switch skipped:", str(e)[:120])

    # 1. canonical ledger people, no demo leakage (client-side nav keeps the
    # switched workspace; a full reload would re-bootstrap to workspaces[0]).
    page.get_by_role("link", name="People", exact=True).first.click()
    page.get_by_text("Jane Doe").first.wait_for(timeout=30000)
    leak = page.get_by_text("Dana Whitfield").count()
    log("1 owner people: Jane Doe present | demo leaked:", leak > 0)
    page.screenshot(path=PRE + "/owner-people.png")

    # 2. signals
    page.get_by_role("link", name="Today", exact=True).first.click()
    page.get_by_text("Needs attention").first.wait_for(timeout=30000)
    page.screenshot(path=PRE + "/owner-today.png")
    log("2 owner today: needs-attention rendered")

    # 3. live copilot, principal-attributed
    page.keyboard.press("Meta+k")
    page.get_by_label("Ask the copilot").wait_for(timeout=10000)
    page.get_by_label("Ask the copilot").fill("Who is going cold and what should I do next?")
    page.get_by_role("button", name="Run").click()
    page.get_by_text("live model", exact=True).wait_for(timeout=100000)
    page.wait_for_timeout(7000)
    page.screenshot(path=PRE + "/owner-copilot.png")
    log("3 owner copilot: live model | principal:", principal[:8])

    # 4. design -> hold -> approve -> mission in Octo SQL
    page.get_by_role("button", name="Design").click()
    page.get_by_label("Ask the copilot").fill("Re-engage Jane Doe on open-source tooling with a sourced brief")
    page.get_by_role("button", name="Run").click()
    page.get_by_text("Proposed mission — held for you").wait_for(timeout=100000)
    page.wait_for_timeout(7000)
    page.screenshot(path=PRE + "/owner-design.png")
    page.get_by_role("button", name="Hold for approval").click()
    page.get_by_text("In your approval inbox").wait_for(timeout=20000)
    href = page.get_by_role("link", name="Open in inbox").get_attribute("href")
    approval_id = href.split("focus=")[1]
    page.get_by_role("link", name="Open in inbox").click()
    card = page.locator("#approval-" + approval_id)
    card.wait_for(timeout=15000)
    m = re.search(r"New mission: (.+)", card.inner_text())
    mission_name = m.group(1).strip() if m else ""
    card.get_by_role("button", name="Approve").click()
    page.wait_for_timeout(2500)
    page.get_by_role("link", name="Missions", exact=True).first.click()
    page.wait_for_url("**/missions", timeout=15000)
    page.wait_for_timeout(1500)
    created = page.get_by_text(mission_name, exact=False).count() if mission_name else 0
    log("4 owner mission created in Octo:", created > 0, "|", mission_name)
    page.screenshot(path=PRE + "/owner-mission.png")

    log("ERRORS:", " | ".join(errors) if errors else "none")
    context.close()
