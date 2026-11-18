# Governance — read before you add a person

You are building a graph of real, identifiable people, some of whom have not agreed
to be in it. That is not automatically wrong (public data is public), but it sets the
rules. This file is the short version you should check yourself against.

## 1. What this graph is for

Recording **what people have publicly said and built**, and **who publicly knows
whom**, so you can find shared ground before starting a conversation.

That is it. The project is a *preparation* tool, not a *manipulation* tool.

## 2. The line

Everything below is over the line, regardless of how available the data is:

- **Do not infer sensitive attributes.** Religion, ethnicity, health, disability,
  sexual orientation, immigration status, political affiliation, union activity,
  pregnancy, criminal record. This is not a style preference — inferring some of
  these about people is illegal in a regulated hiring or lending context, and
  profiling on them is illegal in many jurisdictions outright (GDPR Art. 9, NYC
  Local Law 144 for hiring tools, disparate-impact doctrine in the US).
- **Do not build a lever.** "Her colleague is in debt", "his kid is sick", "she's
  about to be laid off" — these are not shared ground. They are pressure points.
  The moment the graph is used to find a vulnerable moment, this project is doing
  social engineering in the harmful sense, and the word "social engineering" in the
  folder name stops being a metaphor.
- **Do not scrape past a rate limit or a ToS.** LinkedIn's User Agreement forbids
  scraping. Getting a 429 and routing around it is the point at which "public data"
  stops being your defence.
- **Do not fabricate a connection.** A `MET` edge based on "we were both at the same
  conference" is worth saying as exactly that. Dressing it up as a relationship is
  how warm intros turn into burned bridges.

## 3. Sourcing rules

| Source | OK? | Notes |
|---|---|---|
| Person's own website / blog | Yes | They published it to be read |
| Public GitHub repos, work they authored | Yes | With the profile URL |
| Conference talk pages, speaker bios | Yes | Usually self-submitted |
| Podcast transcripts | Yes | Quote them accurately |
| Company "about" / team pages | Yes | Role + org only |
| LinkedIn profile | Careful | Free to read as a human; scraping violates the User Agreement. Record the URL, take the facts manually, don't bulk-harvest |
| Private Slack/Discord | No | Off-limits regardless of access |
| Anything behind a login you have | No | Access is not permission |
| Data brokers / leaked sets | No | Delete on sight |

## 4. The quote rule

Every `positions:` entry needs a **verbatim quote**. The loader enforces a minimum
length and refuses paraphrases.

Why so strict: a paraphrase is your interpretation of their politics, and it will be
subtly wrong in a direction that flatters whatever you wanted them to believe. Then
you open a conversation with a caricature of them, and they notice immediately. The
quote is the difference between research and projection.

Corollary: if you can't find a quote, the position goes in `unverified:`.

## 5. Accuracy review

Claims rot. People change jobs, change minds, and delete posts. `queries/social.cypher`
query 7 is a staleness report — run it monthly and re-verify or close out what it
returns.

When a claim turns out to be wrong:

- **Never delete it.** Octo's ledger is append-only by design (`superseded_at`, not
  `DELETE`). Insert the correction and close the old row's interval.
- Record the correction through `octo.claims` + `claim_relations`, so query 10
  surfaces the contradiction rather than hiding it.

The reason to keep the wrong version is that "we thought X on Tuesday and corrected
it" is useful history, and because a graph that quietly rewrites itself is one you
can't audit.

## 6. Subject access

If someone asks what you have on them: tell them. Show the claims, the sources, and
close out anything they say is wrong. This is required under GDPR/CCPA for people in
those jurisdictions and is just decent behaviour everywhere else. Budget for it —
it's a query, not a project, because every fact already carries its source.

## 7. Scope creep warning

The realistic failure mode of this project is not a data breach. It is that it
becomes a file of dossiers on people you might one day want something from, which
then leaks, or which you send to the wrong person, or which makes you act weirdly
transactional in conversations.

Two cheap guards:

1. **Keep the workspace scoped.** One Octo workspace, workspace-scoped key
   (`octo_live_ws_`), not an account-wide key. Check that in code, not in your head.
2. **Ask the question first.** Before adding a person, ask: *would I be comfortable
   showing them this entry?* If no, it belongs in `unverified:` or nowhere.
