// queries/social.cypher
//
// Query library for the social graph, run via queries/run.py.
//
// THE SHAPE OF THE GRAPH — read this before editing a query.
//
// Octo's projector (src/graph/projector.ts) builds exactly five edge types:
//
//   (Claim)-[:SUBJECT]->(Entity)        which entity a claim is about
//   (Belief)-[:ABOUT]->(Claim)
//   (Belief)-[:HELD_BY]->(Perspective)
//   (Claim)-[:CITES {stance}]->(Evidence)
//   (Claim)-[:RELATES {relation}]->(Claim)   claim-to-claim only
//
// There are NO entity-to-entity edges. A relationship between two people is not
// an edge; it is a Claim whose subject is one person and whose `provenance`
// names the other. Same for org membership and event attendance.
//
// So every traversal here is: entity <-[:SUBJECT]- claim, filtered on the
// `verb` inside provenance, then a second claim hop. `provenance` is projected
// as a JSON *string*, so it is matched with CONTAINS, and verbs are chosen so
// one CONTAINS cannot match another.
//
// THE LIVENESS GUARD. The ledger is append-only: a corrected or duplicate fact
// is superseded, never deleted. Every claim match below therefore carries
//   AND c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
// Without it, superseded rows reappear and queries double-count. If you add a
// query, include the guard.
//
// Slugs vs names: provenance carries slugs (`"org":"acme-labs"`,
// `"peer":"sam-rivera"`); Entity.name carries the display name. Params for
// provenance filters are the quoted fragment, e.g. '"org":"acme-labs"'.

// ===========================================================================
// 1. DIRECT INTRO — every live relationship claim touching a person, in both
// directions. A link is stored from each side, so this shows who introduced
// them to whom and on what basis.
// params: $slug (person slug), $displayName
// ===========================================================================
MATCH (c:Claim)-[:SUBJECT]->(p:Entity)
WHERE c.provenance CONTAINS '"verb":"MET"'
  AND c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
  AND (c.provenance CONTAINS $slug OR p.name = $displayName)
RETURN p.name       AS recorded_from,
       c.statement  AS link,
       c.provenance AS provenance,
       c.validFrom  AS since
ORDER BY since DESC;

// ===========================================================================
// 2. SHARED EMPLOYER — two people whose current jobs are at the same org.
// The cheapest warm-intro signal, and it needs no relationship record at all.
// params: $orgSlug (e.g. '"org":"acme-labs"')
// ===========================================================================
MATCH (a:Claim)-[:SUBJECT]->(p:Entity)
MATCH (b:Claim)-[:SUBJECT]->(q:Entity)
WHERE a.provenance CONTAINS '"verb":"WORKS_AT"'
  AND b.provenance CONTAINS '"verb":"WORKS_AT"'
  AND a.provenance CONTAINS $orgSlug
  AND b.provenance CONTAINS $orgSlug
  AND a.validTo IS NULL AND b.validTo IS NULL
  AND a.supersededAt IS NULL AND b.supersededAt IS NULL
  AND p.id < q.id
RETURN p.name AS person_a, a.statement AS role_a,
       q.name AS person_b, b.statement AS role_b;

// ===========================================================================
// 3. WHERE DOES THIS PERSON STAND? — stated positions, in their own words,
// with the source URL. This is the query the project exists for.
// params: $name (display name)
// ===========================================================================
MATCH (p:Entity {name: $name})<-[:SUBJECT]-(c:Claim)-[:CITES]->(e:Evidence)
WHERE c.provenance CONTAINS '"verb":"POSITION"'
  AND c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
MATCH (b:Belief)-[:ABOUT]->(c)
RETURN c.statement  AS position,
       e.quote      AS their_exact_words,
       e.locator    AS source,
       b.stance     AS stance,
       b.confidence AS confidence
ORDER BY confidence DESC;

// ===========================================================================
// 4. SHARED GROUND — what one person says about a topic, next to what everyone
// else in the graph says about one. Use it to find a real conversation topic.
// params: $name
// ===========================================================================
MATCH (p:Entity {name: $name})<-[:SUBJECT]-(mine:Claim)-[:CITES]->(m:Evidence)
WHERE mine.provenance CONTAINS '"verb":"POSITION"'
  AND mine.supersededAt IS NULL
MATCH (other:Entity)<-[:SUBJECT]-(theirs:Claim)-[:CITES]->(o:Evidence)
WHERE theirs.provenance CONTAINS '"verb":"POSITION"'
  AND theirs.supersededAt IS NULL
  AND other.name <> $name
RETURN other.name       AS also_speaks_about,
       other.entityType AS kind,
       theirs.statement AS their_position
LIMIT 40;

// ===========================================================================
// 5. ORG ROSTER — everyone I track at an org, current roles only.
// params: $orgSlug
// ===========================================================================
MATCH (c:Claim)-[:SUBJECT]->(p:Entity)
WHERE c.provenance CONTAINS '"verb":"WORKS_AT"'
  AND c.provenance CONTAINS $orgSlug
  AND c.validTo IS NULL
  AND c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
RETURN p.name AS person, c.statement AS role, c.validFrom AS since
ORDER BY since;

// ===========================================================================
// 6. INFLUENCE — who is named in the most live relationship claims.
// Runs over claims rather than edges because links are stored per side.
// ===========================================================================
MATCH (c:Claim)-[:SUBJECT]->(p:Entity)
WHERE c.provenance CONTAINS '"verb":"MET"'
  AND c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
RETURN p.name AS person, count(*) AS relationship_claims
ORDER BY relationship_claims DESC
LIMIT 20;

// ===========================================================================
// 7. STALE CLAIMS — the refresh queue: anything recorded before $cutoff.
// Pass the cutoff as an ISO timestamp, not a number of days: this FalkorDB build
// answers 502 to duration()/datetime() arithmetic inside a query, so run.py
// computes --days into $cutoff before sending.
// params: $cutoff
// ===========================================================================
MATCH (c:Claim)-[:SUBJECT]->(s:Entity)
WHERE c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
  AND c.recordedAt < $cutoff
RETURN s.name AS subject, c.statement AS claim,
       c.validTo AS ended, c.recordedAt AS last_recorded
ORDER BY last_recorded
LIMIT 100;

// ===========================================================================
// 8. RECRUITING SCORECARD — what each person has publicly built, with proof
// links, and how many live claims exist about them in total.
// ===========================================================================
MATCH (p:Entity)
WHERE p.entityType = 'person'
OPTIONAL MATCH (p)<-[:SUBJECT]-(all:Claim)
  WHERE all.supersededAt IS NULL
OPTIONAL MATCH (p)<-[:SUBJECT]-(built:Claim)-[:CITES]->(be:Evidence)
  WHERE built.provenance CONTAINS '"verb":"BUILT"' AND built.supersededAt IS NULL
RETURN p.name AS person,
       count(DISTINCT all) AS claims,
       count(DISTINCT built) AS built_things,
       collect(DISTINCT be.locator) AS proof_links
ORDER BY built_things DESC, claims DESC;

// ===========================================================================
// 9. EVENT SPILLOVER — people whose claims are sourced from the same venue or
// event. Note the CITES hop comes off the CLAIM, not the Entity: evidence is
// attached to a claim. Traversing (p:Entity)-[:CITES]->(e) silently returns
// nothing, which is how this got found.
// params: $venue (matched against the claim's provenance and the evidence URL)
// ===========================================================================
MATCH (c:Claim)-[:SUBJECT]->(p:Entity)
MATCH (c)-[:CITES]->(e:Evidence)
WHERE c.supersededAt IS NULL
  AND NOT c.provenance CONTAINS '"verb":"DUP_MARKER"'
  AND (c.provenance CONTAINS $venue OR e.locator CONTAINS $venue)
RETURN p.name AS person, c.statement AS what, e.locator AS source
LIMIT 50;

// ===========================================================================
// 10. CONTRADICTIONS AND QUARANTINE — claim-to-claim contradictions plus every
// claim with no evidence. The second half is what keeps the graph honest:
// anything unrested by a CITES edge shows up here rather than in a clean answer.
// ===========================================================================
MATCH (a:Claim)-[:RELATES {relation: 'CONTRADICTS'}]->(b:Claim)
MATCH (a)-[:SUBJECT]->(p:Entity)
RETURN 'contradiction' AS kind, p.name AS subject,
       a.statement AS detail_a, b.statement AS detail_b
UNION
MATCH (c:Claim)-[:SUBJECT]->(p:Entity)
WHERE c.supersededAt IS NULL
  AND c.provenance CONTAINS '"verb":"UNVERIFIED"'
  AND NOT (c)-[:CITES]->(:Evidence)
RETURN 'unverified' AS kind, p.name AS subject, c.statement AS detail_a, '' AS detail_b;
