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

/**
 * What a reply to "Approve <title>? Say yes or no." means.
 *
 * The model may suggest that the person wants to approve or decline, but it
 * never writes: the page reads the decision back and only the person's own
 * clear word records it. "Yes" confirms whichever decision was read back;
 * "no" drops it; anything else, including a negation or a new question, is
 * unclear and records nothing.
 */
export type Confirmation = "confirm" | "cancel" | "unclear";

export const resolveConfirmation = (heard: string): Confirmation => {
  const command = parseVoiceCommand(heard);
  if (command === "approve") return "confirm";
  if (command === "decline" || command === "skip" || command === "end") return "cancel";
  return "unclear";
};

/** Phrases that end a spoken conversation off a call. */
const DONE = ["stop", "that's all", "that is all", "thanks", "thank you", "i'm done", "goodbye", "bye", "never mind"];

export const isConversationOver = (heard: string): boolean => {
  const text = normalise(heard);
  if (!text || text.split(" ").length > MAX_WORDS) return false;
  return DONE.some((phrase) => containsPhrase(text, phrase));
};
