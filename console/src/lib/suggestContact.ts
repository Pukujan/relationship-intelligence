/**
 * A contact whose name matches a chat's display name, offered only as a
 * starting point in "Conversations to match" (#120). The owner still confirms:
 * PROJECT.md rule 6 means a name never links an identity on its own. Returns
 * "" unless exactly one contact matches.
 */
import type { Person } from "../data/types";

const normalise = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A contact whose name matches the chat's, offered as a starting point only. */
export const suggestContact = (name: string, people: Pick<Person, "id" | "name">[]): string => {
  const wanted = normalise(name);
  if (!wanted) return "";
  const exact = people.filter((p) => normalise(p.name) === wanted);
  if (exact.length === 1) return exact[0]?.id ?? "";
  const tokens = wanted.split(" ");
  const partial = people.filter((p) => {
    const theirs = normalise(p.name).split(" ");
    return tokens.length >= 2 && tokens.every((t) => theirs.includes(t));
  });
  return partial.length === 1 ? (partial[0]?.id ?? "") : "";
};

