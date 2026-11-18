#!/usr/bin/env python3
"""
Render the workspace graph as an interactive HTML page.

    python viz/graph.py                     # writes viz/graph.html
    python viz/graph.py --open              # and opens it
    python viz/graph.py --focus "Jane Doe"  # ego network around one person
    python viz/graph.py --paths "A" "B"     # highlight shortest paths between two people

Why this exists in your repo rather than Octo: Octo's graph is a claim ledger, not
a person-network. Turning claims into a drawable social network is an adopter
concern, so it lives here. We read claims from /api/graph/query and build the
network in networkx, then hand it to pyvis.

Two layouts, and the choice matters:
  * default      -- everything, clustered, good for spotting structure
  * --focus NAME -- one person's ego network, good for "who do I know near this"
  * --paths A B  -- shortest path(s) with the intermediaries highlighted, which is
                    the actual warm-intro question
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict

import networkx as nx
from pyvis.network import Network

HERE = os.path.dirname(os.path.abspath(__file__))

# Node colours by entity type. People warm, orgs cool, events green, topics purple.
PALETTE = {
    "person": "#ff7b54",
    "org": "#4ea8de",
    "event": "#56c596",
    "topic": "#b388ff",
    "other": "#9aa0a6",
}

PERSON_SLUG_FIELD = "peer"


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
            "User-Agent": "social-graph-viz/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Octo {e.code} on {path}: {e.read().decode()[:500]}") from None


def query(cypher: str, params: dict | None = None) -> list[dict]:
    return api("/api/graph/query", {
        "workspaceId": os.environ["OCTO_WORKSPACE_ID"],
        "query": cypher,
        "params": params or {},
    }).get("rows", [])


def colour_for(etype: str) -> str:
    for k, v in PALETTE.items():
        if etype == k or etype.startswith(f"{k}:"):
            return v
    return PALETTE["other"]


def load_graph() -> tuple[nx.Graph, dict]:
    """
    Reads the ledger and builds a person-and-context network.

    Nodes come from Entity rows. Edges are derived per verb:
      WORKS_AT      person <-> org        (from provenance org slug)
      MET           person <-> person     (from provenance peer slug)
      PRESENTED_AT  person <-> event      (from venue/title, matched to an event node)
      POSITION      person <-> topic      (from provenance topic)

    A claim is the unit of evidence, so an edge carries the claims that created it:
    how many, their sources, and the strongest confidence. That's what lets you
    tell "three independent sources agree" from "one podcast mention".
    """
    entities = query(
        "MATCH (e:Entity) RETURN e.id AS id, e.name AS name, e.entityType AS type"
    )
    # Superseded claims are excluded: the ledger keeps corrections, the network
    # should show what we currently believe.
    claims = query(
        "MATCH (c:Claim)-[:SUBJECT]->(s:Entity) "
        "WHERE c.supersededAt IS NULL AND NOT c.provenance CONTAINS '\"verb\":\"DUP_MARKER\"' "
        "RETURN c.id AS id, c.statement AS statement, c.provenance AS provenance, "
        "s.id AS subjectId, c.validTo AS validTo"
    )
    cites = query(
        "MATCH (c:Claim)-[:CITES]->(ev:Evidence) RETURN c.id AS claimId, "
        "ev.locator AS locator, ev.quote AS quote"
    )

    by_name = {e["name"]: e for e in entities}
    # Origin is an org the claim's provenance points at by slug; match on the
    # entityType suffix so `org:acme-labs` resolves without a separate lookup.
    by_slug = {}
    for e in entities:
        if ":" in (e["type"] or ""):
            by_slug[e["type"].split(":", 1)[1]] = e

    evidence: dict[str, list[dict]] = defaultdict(list)
    for c in cites:
        evidence[c["claimId"]].append({"source": c["locator"], "quote": c["quote"]})

    G = nx.Graph()
    meta: dict[str, dict] = {}
    for e in entities:
        if not e["type"] or e["type"] == "entity":
            continue
        G.add_node(e["name"], etype=e["type"])
        meta[e["name"]] = {"type": e["type"], "type_label": e["type"].split(":")[0]}

    def link(a: str, b: str, verb: str, claim: dict) -> None:
        if a not in G or b not in G or a == b:
            return
        if G.has_edge(a, b):
            d = G[a][b]
            d["claims"].append(claim)
            d["weight"] = len(d["claims"])
        else:
            G.add_edge(a, b, verb=verb, claims=[claim], weight=1)

    for c in claims:
        prov = c["provenance"] or ""
        try:
            p = json.loads(prov)
        except (ValueError, TypeError):
            continue
        verb = p.get("verb")
        subject = c["subjectId"]
        subject_name = next((n for n, e in by_name.items() if e["id"] == subject), None)
        if not subject_name:
            continue

        claim = {
            "id": c["id"],
            "statement": c["statement"],
            "verb": verb,
            "sources": evidence.get(c["id"], []),
            "ended": c["validTo"],
        }

        if verb == "MET" and p.get(PERSON_SLUG_FIELD):
            peer = by_slug.get(p[PERSON_SLUG_FIELD])
            if peer:
                # Only draw each pair once: the loader writes both directions.
                a, b = sorted([subject_name, peer["name"]])
                link(a, b, "knows", claim)
        elif verb == "WORKS_AT" and p.get("org"):
            org = by_slug.get(p["org"])
            if org:
                link(subject_name, org["name"], "works at", claim)
        elif verb == "PRESENTED_AT":
            for ev in entities:
                if (ev["type"] or "").startswith("event:") and p.get(
                    "venue", ""
                ).lower() in ev["name"].lower():
                    link(subject_name, ev["name"], "spoke at", claim)
        elif verb == "POSITION" and p.get("topic"):
            # Topics are not entities in the seed, so create lightweight nodes.
            topic_name = p["topic"]
            if topic_name not in G:
                G.add_node(topic_name, etype="topic")
                meta[topic_name] = {"type": "topic", "type_label": "topic"}
            link(subject_name, topic_name, "on record about", claim)

    return G, meta


def render(G: nx.Graph, meta: dict, out: str, focus: str | None, paths: tuple[str, str] | None) -> None:
    show = G
    highlighted: set[tuple[str, str]] = set()

    if focus:
        if focus not in G:
            sys.exit(f"no node named {focus!r}; have: {', '.join(sorted(G.nodes))[:400]}")
        show = nx.ego_graph(G, focus, radius=2)
    elif paths:
        a, b = paths
        for n in (a, b):
            if n not in G:
                sys.exit(f"no node named {n!r}")
        try:
            # Shortest simple paths, capped: between two people in a research
            # network there are usually only a handful worth showing.
            found = list(itertools.islice(nx.shortest_simple_paths(G, a, b), 5))
        except nx.NetworkXNoPath:
            sys.exit(f"no path between {a!r} and {b!r}")
        nodes: set[str] = set()
        for path in found:
            nodes.update(path)
            for x, y in zip(path, path[1:]):
                highlighted.add((x, y))
                highlighted.add((y, x))
        show = G.subgraph(nodes)

    net = Network(
        height="820px", width="100%", bgcolor="#12141a", font_color="#e8eaed",
        directed=False, notebook=False,
    )
    net.barnes_hut(gravity=-9000, central_gravity=0.35, spring_length=160)

    for node in show.nodes:
        m = meta.get(node, {"type": "other", "type_label": "other"})
        degree = G.degree(node)
        title = (
            f"<b>{node}</b><br>{m['type_label']}"
            f"<br>connections: {degree}"
        )
        net.add_node(
            node,
            label=node,
            title=title,
            color=colour_for(m["type"]),
            size=16 + min(degree * 2, 30),
            shape="dot" if m["type_label"] == "person" else "box",
        )

    for u, v, d in show.edges(data=True):
        claims = d.get("claims", [])
        sources = [s["source"] for c in claims for s in c["sources"] if s.get("source")]
        uniq_sources = list(dict.fromkeys(sources))
        title = (
            f"<b>{d.get('verb', '').upper()}</b><br>"
            f"{claims[0]['statement'] if claims else ''}<hr>"
            + "<br>".join(f"claim: {c['statement']}" for c in claims)
            + ("<hr>" + "<br>".join(f'<a href="{s}" target="_blank">{s}</a>' for s in uniq_sources)
               if uniq_sources else "<hr><i>no public source (personal knowledge)</i>")
        )
        on_path = (u, v) in highlighted
        net.add_edge(
            u, v,
            title=title,
            label=d.get("verb", ""),
            color="#ffd166" if on_path else "#4a4f5c",
            width=4 if on_path else 1 + len(claims),
            dashes=not bool(uniq_sources),
        )

    html = net.generate_html()
    # pyvis injects <script src="lib/bindings/utils.js">, a path that only exists
    # in pyvis's own template dir. Left in, the file is not standalone: opened from
    # disk it 404s that script and renders a blank canvas. Nothing below uses it
    # (it is only needed for notebook widget bindings), so drop the reference and
    # keep vis-network from the CDN -- the page stays one self-contained file.
    html = html.replace('<script src="lib/bindings/utils.js"></script>', "")
    legend = """
    <div style="position:fixed;left:16px;bottom:16px;background:#1b1e26;color:#e8eaed;
                padding:12px 14px;border-radius:10px;font:13px ui-sans-serif,system-ui;
                border:1px solid #2c3140;z-index:9999">
      <b>social graph</b><br>
      <span style="color:#ff7b54">●</span> person &nbsp;
      <span style="color:#4ea8de">■</span> org &nbsp;
      <span style="color:#56c596">■</span> event &nbsp;
      <span style="color:#b388ff">■</span> topic<br>
      <span style="color:#ffd166">━</span> highlighted path &nbsp;
      <span style="color:#4a4f5c">┅</span> no public source<br>
      <span style="opacity:.7">hover a node or edge for evidence</span>
    </div>
    """
    html = html.replace("</body>", legend + "</body>")
    with open(out, "w") as fh:
        fh.write(html)

    print(f"wrote {out}")
    print(f"  {show.number_of_nodes()} nodes, {show.number_of_edges()} edges")
    if paths:
        print(f"  {len(found)} path(s): {' -> '.join(found[0])}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "graph.html"))
    ap.add_argument("--focus", help="show only a person's 2-hop ego network")
    ap.add_argument("--paths", nargs=2, metavar=("FROM", "TO"),
                    help="highlight shortest paths between two nodes")
    ap.add_argument("--open", action="store_true")
    args = ap.parse_args()

    G, meta = load_graph()
    if G.number_of_nodes() == 0:
        sys.exit("graph is empty — load some people first (seed/load.py --apply --project)")
    render(G, meta, args.out, args.focus, tuple(args.paths) if args.paths else None)

    if args.open:
        import webbrowser
        webbrowser.open(f"file://{os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
