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
