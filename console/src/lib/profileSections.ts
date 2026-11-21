/**
 * Sorts one person's ledger claims into the sections of a profile page
 * (headline, about, experience, education, posts, event log, notes).
 *
 * Pure and dependency-free so `scripts/test-machines.mjs` can run it under
 * Node's type stripping. Two rules hold throughout:
 *   - Headline, about, experience, education, projects, credentials and posts
 *     read only SOURCED claims. An unverified note never becomes profile fact.
 *   - Unverified notes stay visible, always flagged `unverified`, in the event
 *     log (meetings and interaction logs) or the owner's notes.
 */
import type { Claim, RelationshipEvent } from "../data/types";

export interface ProfileEntry {
  id: string;
  title: string;
  subtitle?: string;
  date?: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

export interface PostEntry {
  id: string;
  snippet: string;
  date?: string;
  url?: string;
}

export type EventLogKind = "event" | "met" | "log" | "note";

export interface EventLogEntry {
  id: string;
  kind: EventLogKind;
  title: string;
  detail?: string;
  meta?: string;
  date?: string;
  place?: string;
  eventId?: string;
  unverified: boolean;
}

export interface NoteEntry {
  id: string;
  text: string;
  date?: string;
}

export interface ProfileView {
  headline: string;
  about: string;
  linkedinUrl?: string;
  email?: string;
  stage?: string;
  experience: ProfileEntry[];
  education: ProfileEntry[];
  projects: ProfileEntry[];
  credentials: ProfileEntry[];
  posts: PostEntry[];
  eventLog: EventLogEntry[];
  notes: NoteEntry[];
  sources: Claim[];
}

/** The longest post text the page may show. Posts are summarised, never copied whole. */
export const POST_SNIPPET_MAX = 180;

const URL_RE = /https?:\/\/[^\s)]+/i;

const isSourced = (claim: Claim) => claim.status === "sourced";

/** A claim's own date, or undefined for the epoch placeholder and blanks. */
const dateOf = (claim: Claim): string | undefined => {
  const value = claim.source?.date;
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) || time <= 0 ? undefined : value;
};

const sourceOf = (claim: Claim) => ({
  ...(claim.source?.locator ? { sourceUrl: claim.source.locator } : {}),
  ...(claim.source?.label ? { sourceLabel: claim.source.label } : {}),
});

/**
 * The value of an attribute fact. The importer writes
 * "<Name>, <attribute words>: <value>", so take what follows the attribute's
 * label, falling back to what follows the first ": ".
 */
export const factValue = (claim: Claim): string => {
  const text = claim.text.trim();
  if (claim.attribute) {
    const label = `${claim.attribute.replace(/_/g, " ").toLowerCase()}: `;
    const at = text.toLowerCase().indexOf(label);
    if (at >= 0) return text.slice(at + label.length).trim();
  }
  const colon = text.indexOf(": ");
  return colon >= 0 ? text.slice(colon + 2).trim() : text;
};

/** Shorten to at most `max` characters on a word boundary, adding an ellipsis. */
export const snippet = (text: string, max = POST_SNIPPET_MAX): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
};

/** "[UNVERIFIED] Jane Doe: (self reported) met at X" -> tag "self reported", body "met at X". */
export const parseNote = (text: string): { tag?: string; body: string } => {
  const withoutMarker = text.replace(/^\[UNVERIFIED\]\s*/i, "");
  const withoutName = withoutMarker.replace(/^[^:()]{1,80}:\s+(?=\()/, "");
  const tagged = withoutName.match(/^\(([^)]*)\)\s*(.*)$/s);
  if (!tagged) return { body: withoutName.trim() };
  return { tag: tagged[1].trim(), body: tagged[2].trim() };
};

const POST_ATTR = /(^|_)posts?($|_)/i;
const ABOUT_ATTR = /(^|_)(about|bio|summary)($|_)/i;
const EDUCATION_ATTR = /(^|_)education($|_)/i;
const CREDENTIAL_ATTR = /(^|_)(credential|certification|license)s?($|_)/i;
const PROJECT_ATTR = /(^|_)project(_profile)?($|_)/i;

/** Newest first, undated last, ties broken by id so claim order never matters. */
/** Readable note text: "self reported" -> "(self-reported)", doubled stops collapsed. */
export const tidy = (text: string): string =>
  text
    .replace(/\(?\bself[ _]reported\b\)?/gi, "(self-reported)")
    .replace(/\.{2,}(?=\s|$)/g, ".")
    .replace(/\s+/g, " ")
    .trim();

const byNewest = <T extends { id: string; date?: string }>(a: T, b: T) => {
  if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.date && !b.date) return -1;
  if (b.date && !a.date) return 1;
  return a.id.localeCompare(b.id);
};

const MET_STRENGTH: Record<string, string> = {
  strong: "Close relationship",
  "met-once": "Met in person",
  weak: "Known contact",
};

export const buildProfile = (input: {
  name: string;
  role: string;
  companyName?: string;
  claims: Claim[];
  events: RelationshipEvent[];
}): ProfileView => {
  const { claims, events } = input;
  const experience: ProfileEntry[] = [];
  const education: ProfileEntry[] = [];
  const projects: ProfileEntry[] = [];
  const credentials: ProfileEntry[] = [];
  const posts: PostEntry[] = [];
  const eventLog: EventLogEntry[] = [];
  const notes: NoteEntry[] = [];
  const metAtNotes: { id: string; place: string; date?: string }[] = [];
  let linkedinUrl: string | undefined;
  let email: string | undefined;
  let roleSummary = "";
  let about = "";
  let stage: string | undefined;

  // Walk claims newest first so a single-valued field (headline source,
  // LinkedIn link, email, stage) takes the newest claim, whatever order the
  // ledger returned them in.
  const ordered = claims
    .map((claim) => ({ claim, id: claim.id, date: dateOf(claim) }))
    .sort(byNewest)
    .map(({ claim }) => claim);

  for (const claim of ordered) {
    const verb = (claim.verb ?? "").toUpperCase();
    const attribute = (claim.attribute ?? "").toLowerCase();
    const date = dateOf(claim);

    if (verb === "MET") {
      const strength = claim.text.match(/\(([^)]+)\)\s*$/)?.[1] ?? "";
      eventLog.push({
        id: claim.id,
        kind: "met",
        title: "How you know them",
        ...(claim.basis ? { detail: tidy(claim.basis) } : {}),
        ...(MET_STRENGTH[strength] ? { meta: MET_STRENGTH[strength] } : {}),
        ...(date ? { date } : {}),
        unverified: !isSourced(claim),
      });
      continue;
    }

    if (verb === "UNVERIFIED" || !isSourced(claim)) {
      const { tag, body } = parseNote(claim.text);
      const lowerTag = (tag ?? "").toLowerCase();
      if (lowerTag === "relationship stage") {
        stage ??= tidy(body);
        continue;
      }
      const metAt = body.match(/^met at\s+(.+)$/i);
      if (metAt) {
        metAtNotes.push({ id: claim.id, place: metAt[1].trim(), ...(date ? { date } : {}) });
        continue;
      }
      if (lowerTag.startsWith("private interaction log")) {
        const meta = lowerTag
          .replace(/^private interaction log;?\s*/, "")
          .split(",")
          .map((part) => part.trim().replace(/_/g, " "))
          .filter(Boolean)
          .join(" · ");
        const firstStop = body.search(/\.\s/);
        const title = firstStop > 0 ? body.slice(0, firstStop) : body;
        const detail = firstStop > 0 ? body.slice(firstStop + 1).trim() : "";
        eventLog.push({
          id: claim.id,
          kind: "log",
          title: tidy(title) || "Interaction",
          ...(detail ? { detail: tidy(detail) } : {}),
          ...(meta ? { meta: tidy(meta) } : {}),
          ...(date ? { date } : {}),
          unverified: true,
        });
        continue;
      }
      notes.push({
        id: claim.id,
        text: tidy(tag ? `(${tag}) ${body}` : body),
        ...(date ? { date } : {}),
      });
      continue;
    }

    // Everything below is a sourced claim.
    const source = sourceOf(claim);
    if (verb === "WORKS_AT") {
      const match = claim.text.match(/works at (.+?) as (.+)$/i);
      experience.push({
        id: claim.id,
        title: match ? match[2].trim() : claim.text,
        ...(match ? { subtitle: match[1].trim() } : {}),
        ...(date ? { date } : {}),
        ...source,
      });
      continue;
    }
    if (verb === "POSITION") {
      continue; // a stance on a topic, shown under sources only
    }
    if (verb === "PRESENTED_AT") {
      const match = claim.text.match(/presented ['"](.+)['"] at (.+)$/i);
      projects.push({
        id: claim.id,
        title: match ? `Talk: ${match[1]}` : claim.text,
        ...(match ? { subtitle: match[2].trim() } : {}),
        ...(date ? { date } : {}),
        ...source,
      });
      continue;
    }
    if (verb === "BUILT") {
      const match = claim.text.match(/built ([^:]+):?\s*(.*)$/i);
      projects.push({
        id: claim.id,
        title: match ? match[1].trim() : claim.text,
        ...(match?.[2] ? { subtitle: match[2].trim() } : {}),
        ...(date ? { date } : {}),
        ...source,
      });
      continue;
    }
    if (verb !== "FACT") continue;

    if (attribute === "linkedin_url") {
      const locator = claim.source?.locator ?? "";
      linkedinUrl ??= /linkedin\.com/i.test(locator)
        ? locator
        : claim.text.match(URL_RE)?.[0];
      continue;
    }
    if (attribute === "professional_email") {
      email ??= factValue(claim).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      continue;
    }
    if (attribute === "public_role_summary") {
      roleSummary ||= factValue(claim);
      continue;
    }
    if (POST_ATTR.test(attribute)) {
      posts.push({
        id: claim.id,
        snippet: snippet(factValue(claim)),
        ...(date ? { date } : {}),
        ...(claim.source?.locator ? { url: claim.source.locator } : {}),
      });
      continue;
    }
    if (EDUCATION_ATTR.test(attribute)) {
      education.push({ id: claim.id, title: factValue(claim), ...(date ? { date } : {}), ...source });
      continue;
    }
    if (CREDENTIAL_ATTR.test(attribute)) {
      credentials.push({ id: claim.id, title: factValue(claim), ...(date ? { date } : {}), ...source });
      continue;
    }
    if (PROJECT_ATTR.test(attribute)) {
      projects.push({ id: claim.id, title: factValue(claim), ...(date ? { date } : {}), ...source });
      continue;
    }
    if (ABOUT_ATTR.test(attribute) && !about) {
      about = factValue(claim);
    }
  }

  // An event the person attended is known only through the owner's own
  // "met at <event>" note, so a matching note folds into the event entry
  // (keeping its unverified flag) instead of appearing twice.
  const normalise = (value: string) => value.trim().replace(/\.$/, "").toLowerCase();
  const notedPlaces = new Set(metAtNotes.map((note) => normalise(note.place)));
  for (const event of events) {
    const notedHere = notedPlaces.has(normalise(event.name));
    eventLog.push({
      id: `event:${event.id}`,
      kind: "event",
      title: event.name,
      ...(event.outcome || event.goal ? { detail: event.outcome || event.goal } : {}),
      meta: notedHere
        ? "You noted you met here"
        : event.status === "past"
          ? "Attended"
          : "Upcoming",
      ...(event.date && Date.parse(event.date) > 0 ? { date: event.date } : {}),
      ...(event.location ? { place: event.location } : {}),
      eventId: event.id,
      unverified: notedHere,
    });
  }
  const eventNames = new Set(events.map((event) => normalise(event.name)));
  for (const note of metAtNotes) {
    if (eventNames.has(normalise(note.place))) continue;
    eventLog.push({
      id: note.id,
      kind: "note",
      title: `Met at ${note.place.replace(/\.$/, "")}`,
      ...(note.date ? { date: note.date } : {}),
      unverified: true,
    });
  }

  if (experience.length === 0 && roleSummary) {
    const roleClaim = ordered.find(
      (claim) => claim.attribute === "public_role_summary" && isSourced(claim),
    );
    experience.push({
      id: roleClaim?.id ?? "role-summary",
      title: roleSummary,
      ...(roleClaim && dateOf(roleClaim) ? { date: dateOf(roleClaim) } : {}),
      ...(roleClaim ? sourceOf(roleClaim) : {}),
    });
  }

  const role = input.role && input.role !== "—" ? input.role : "";
  const headline = role
    ? input.companyName && !role.toLowerCase().includes(input.companyName.toLowerCase())
      ? `${role} at ${input.companyName}`
      : role
    : roleSummary;

  return {
    headline,
    about,
    ...(linkedinUrl ? { linkedinUrl } : {}),
    ...(email ? { email } : {}),
    ...(stage ? { stage } : {}),
    experience: experience.sort(byNewest),
    education: education.sort(byNewest),
    projects: projects.sort(byNewest),
    credentials: credentials.sort(byNewest),
    posts: posts.sort(byNewest),
    eventLog: eventLog.sort(byNewest),
    notes: notes.sort(byNewest),
    sources: claims
      .filter(isSourced)
      .map((claim) => ({ claim, id: claim.id, date: dateOf(claim) }))
      .sort(byNewest)
      .map(({ claim }) => claim),
  };
};
