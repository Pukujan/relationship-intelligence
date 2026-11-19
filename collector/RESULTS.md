# Slice 1 result — the daemon proof passed

**Verdict: PASS.** A persistent local browser profile keeps a LinkedIn
session across a full process restart, from a residential connection,
without a re-authentication challenge. Recorded for issue #15.

## What was run

A real browser (Brave) with a dedicated persistent profile, attached over
the Chrome DevTools Protocol. The owner signed in manually once; the code
never handled a credential. Then, in order:

1. **Attach** — connected over CDP, `navigator.webdriver` was `false`, and
   the durable `li_at` session cookie was present.
2. **Read-only fetch** — one visit to the signed-in user's own profile via
   the `/in/me/` redirect. Loaded signed in.
3. **Restart** — the browser process was terminated and relaunched against
   the same profile directory.
4. **Post-restart check and fetch** — `li_at` still present, no redirect to
   a login wall, and the own-profile fetch loaded signed in again. No
   challenge, no re-authentication.

That is the acceptance criterion from `docs/COLLECTION-EXECUTION.md`: the
session survives a restart.

## Two negative findings that shape the design

1. **Google OAuth refuses automation-launched browsers.** A browser started
   by Playwright was blocked at Google sign-in with "This browser or app
   may not be secure." The daemon must attach to a browser the human
   launched, not launch one itself.
2. **A test build cannot hold a LinkedIn session.** Chrome for Testing
   received only a session-scoped `JSESSIONID` and no durable `li_at`; its
   login dies when the browser closes. A real, non-test browser is
   required for the session to persist. This was confirmed by reading each
   profile's cookie store, not inferred.

## Consequence for TinyFish

Local attach-to-a-real-browser works without TinyFish, so TinyFish can be
dropped as the transport. The daemon contract stays reversible per the
decision doc in case a source later needs a managed browser.

## Data handling

The profile cookies and the one own-profile screenshot stayed in a
permission-restricted temporary directory outside the repository and were
never committed. Only this summary and the proof code are tracked.

## Reproduce

See `README.md` for the commands. The attach variant (`src/attach.ts`) is
the one that matches the accepted design: the human launches the browser
with a debugging port, and the code attaches.
