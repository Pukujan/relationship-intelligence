# LinkedIn crawler on the VPS

The slow LinkedIn crawler (`collector/src/crawl.ts`) runs on octo-vps here, so it
no longer needs your Mac awake. LinkedIn still sees your home internet address:
the stack sends its traffic through a device at home over Tailscale (#118).

Three containers share one network:

| Container | What it does |
|---|---|
| `ri-crawler-tailscale` | Joins your tailnet as `ri-crawler` and uses the home device as its exit node. Reports healthy only while that exit node is online. |
| `ri-crawler-browser` | A normal Chromium with a saved profile. You sign in to LinkedIn in it once, through a web view at `http://ri-crawler:3000` that only your tailnet can reach. |
| `ri-crawler-runner` | Starts one crawl pass an hour and attaches to that Chromium. The app still sets the pace: 45–90 seconds between pages, 40 profiles a day, and a 24-hour stop after any block. |

Only this stack's traffic goes through home. The VPS and every other service keep
their usual route. If the home device goes offline, Tailscale drops the crawler's
traffic rather than sending it from the VPS address.

## One-time setup

You do these steps; no agent handles your passwords or keys.

1. **Turn on the exit node at home.** On `teresas-macbook-pro`, open the Tailscale
   menu and choose *Exit Node → Run as Exit Node*. Then approve it in the Tailscale
   admin console (*Machines → teresas-macbook-pro → Edit route settings → Use as
   exit node*). Keep that Mac awake and online; the crawler pauses whenever it isn't.
2. **Make an auth key.** In the Tailscale admin console, *Settings → Keys →
   Generate auth key* (reusable off, ephemeral off).
3. **Fill the env file on the VPS.** Create
   `/home/ubuntu/apps/relationship-intelligence-crawler.env`, readable only by you:

   ```sh
   TS_AUTHKEY=tskey-auth-...
   CRAWLER_VIEW_PASSWORD=pick-a-password-for-the-web-view
   RI_CRAWL_TOKEN=same-value-as-CRAWLER_TOKEN-in-the-app-env
   # optional: CRAWLER_EXIT_NODE=teresas-macbook-pro
   ```

4. **Start it.**

   ```sh
   cd ~/apps/relationship-intelligence   # the app's checkout on the VPS
   docker compose --env-file /home/ubuntu/apps/relationship-intelligence-crawler.env \
     -f deploy/crawler/docker-compose.yml up -d --build
   ```

5. **Sign in to LinkedIn once.** From any device on your tailnet, open
   `http://ri-crawler:3000`, log in with user `owner` and your web-view password,
   and sign in to LinkedIn in that browser. The session is saved in the
   `browser-profile` volume and survives restarts.

## LinkedIn DMs (optional)

The same runner can read your LinkedIn messages after each crawl pass and add
them to each contact's private history (#120). It only reads; it never sends.

1. Pick a long random value and add it to the **app's** env file on the VPS as
   `DM_INGEST_TOKEN=...`, then redeploy the app.
2. Add the same value to the crawler env file as `RI_DM_TOKEN=...` and restart
   the stack with the `up -d --build` command above.

Each pass reads up to 15 conversations that changed since the last pass, 20–40
seconds apart, and stops at any login wall. Messages are matched to a contact
only by their LinkedIn profile link; threads with anyone else are stored but
not attached to a contact. A day's messages show on the contact's event log the
next day, once the day is complete. Only you can see them.

## Telegram DMs (optional)

Telegram runs as its own service, `ri-crawler-telegram`, on the VPS's normal
network; its official API doesn't need your home address. It reads your
one-to-one chats from the last 90 days, then new messages every 15 minutes. It
never sends, and it doesn't mark anything as read.

1. Get an API id and hash at <https://my.telegram.org> → *API development tools*.
   Add them to the crawler env file as `TELEGRAM_API_ID=...` and
   `TELEGRAM_API_HASH=...`. `RI_DM_TOKEN` must be set too (see above).
2. Sign in once. You type your phone number, the code Telegram sends, and your
   two-step password if you have one:

   ```sh
   docker compose --env-file /home/ubuntu/apps/relationship-intelligence-crawler.env \
     -f deploy/crawler/docker-compose.yml run --rm telegram \
     ./node_modules/.bin/tsx src/telegram.ts login
   ```

3. Restart the stack. New chats appear under **People → Conversations to
   match**. Link each one to its contact once, and later messages attach by
   themselves.

## WhatsApp DMs (optional)

WhatsApp runs as `ri-crawler-whatsapp`, a linked device on your account, like
WhatsApp Web. It shares the crawler's home-address network, so WhatsApp sees
your home connection. When you link it, WhatsApp sends your recent chats; after
that, new one-to-one messages arrive as they happen and reach the app every 5
minutes. Groups are skipped. It never sends anything, doesn't mark messages as
read, and doesn't show you as online.

1. Make sure `RI_DM_TOKEN` is set (see LinkedIn DMs above).
2. Link it once. A QR code appears in your terminal; on your phone open
   WhatsApp → *Settings → Linked devices → Link a device* and scan it:

   ```sh
   docker compose --env-file /home/ubuntu/apps/relationship-intelligence-crawler.env \
     -f deploy/crawler/docker-compose.yml run --rm whatsapp \
     ./node_modules/.bin/tsx src/whatsapp.ts login
   ```

3. Restart the stack. Chats appear under **People → Conversations to match**.
   WhatsApp gives a phone number for each chat, so linking a chat records that
   number on the contact.

If you remove the linked device on your phone, the service stops and logs that
it needs `login` again.

## Discord DMs (optional)

Discord runs as `ri-crawler-discord` on the home-address network. It reads your
one-to-one DMs (not servers or group DMs) every 15 minutes through Discord's web
API with your own account token: the latest 100 messages per DM from the last
90 days on the first pass, then only newer ones. It waits whenever Discord asks
it to slow down, and never sends, reacts or marks anything as read.

1. Copy your account token from Discord in a browser (developer tools →
   Network → any request to `discord.com/api` → the `Authorization` header).
   Treat it like a password: anyone with it can use your account.
2. Add it to the crawler env file as `DISCORD_USER_TOKEN=...`, with
   `RI_DM_TOKEN` set as above, and restart the stack.
3. DMs appear under **People → Conversations to match**; linking one records
   that Discord account on the contact.

Changing your Discord password replaces the token, and the service then logs a
401 until you update it.

## Checking it

```sh
# The address LinkedIn sees: should be your home address, not the VPS's.
docker exec ri-crawler-tailscale wget -qO- https://ifconfig.me; echo
# The crawler's recent passes.
docker logs --tail 30 ri-crawler-runner
```

## Stopping it

```sh
docker compose -f deploy/crawler/docker-compose.yml down
```

`down` keeps the saved LinkedIn session. Add `-v` only if you want to wipe it.
