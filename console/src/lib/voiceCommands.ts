/**
 * Maps what the browser heard during a call to one call action.
 *
 * A voice decision writes to the real approval inbox, so this errs towards
 * doing nothing: only a short utterance that is clearly one command acts, and
 * anything negated or mixed ("don't approve", "yes, skip")
 * returns null so the page asks again instead of guessing.
 */
export type VoiceCommand = "approve" | "decline" | "skip" | "end";

const WORDS: Record<VoiceCommand, string[]> = {
  approve: ["approve", "approved", "yes", "yep", "yeah", "do it", "go ahead", "send it"],
  decline: ["decline", "declined", "reject", "deny", "no", "nope"],
  skip: ["skip", "next", "pass", "later"],
  end: ["end call", "end the call", "hang up", "goodbye", "bye"],
};

/** Words that turn a command into its opposite or into doubt. */
const NEGATORS = ["don't", "do not", "not", "never", "wait", "cancel", "maybe"];

/** Longer than this is a sentence, not a command. */
const MAX_WORDS = 6;

const normalise = (heard: string) =>
  heard
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsPhrase = (text: string, phrase: string) =>
  new RegExp(`(^| )${phrase}( |$)`).test(text);

export const parseVoiceCommand = (heard: string): VoiceCommand | null => {
  const text = normalise(heard);
  if (!text || text.split(" ").length > MAX_WORDS) return null;

  // "End call" wins outright: it decides nothing, so it is always safe.
  if (WORDS.end.some((phrase) => containsPhrase(text, phrase))) return "end";

  // "Don't approve" could be read as decline, but guessing at a negation is
  // how a wrong decision gets recorded. Ask again instead.
  if (NEGATORS.some((phrase) => containsPhrase(text, phrase))) return null;

  const matched = (["approve", "decline", "skip"] as const).filter((command) =>
    WORDS[command].some((phrase) => containsPhrase(text, phrase)),
  );
  // Exactly one intent, or nothing: "yes, skip" is refused too.
  return matched.length === 1 ? matched[0] : null;
};
