/**
 * The autocorrect rules, as pure functions over text.
 *
 * Kept free of CodeMirror so each rule can be tested by asking what it does to
 * a string and a caret, which is the only way to be confident about something
 * that rewrites what a person is in the middle of typing.
 */

export interface AutoCorrectOptions {
  /** Misspellings, sentence capitalization, and stray double spaces. */
  corrections: boolean;
  /** Curly quotes, em dashes, ellipses. */
  smartPunctuation: boolean;
}

export interface Correction {
  from: number;
  to: number;
  insert: string;
  /** Which rule fired. Surfaced in tests and in the undo description. */
  rule: string;
}

/**
 * Misspellings with exactly one plausible correction.
 *
 * The bar for entry is that no competent writer ever means the left-hand side.
 * "its"/"it's" and "their"/"there" are absent for that reason — they are real
 * words, and an editor that silently picks one is worse than one that picks
 * none.
 */
export const TYPO_CORRECTIONS: Record<string, string> = {
  abbout: "about", abotu: "about", accomodate: "accommodate", acheive: "achieve",
  acheived: "achieved", acommodate: "accommodate", adn: "and", agian: "again",
  alot: "a lot", allready: "already", alwasy: "always", amoung: "among",
  anual: "annual", apparant: "apparent", arguement: "argument", becuase: "because",
  begining: "beginning", beleive: "believe", belive: "believe", bewteen: "between",
  calender: "calendar", cant: "can't", carefull: "careful", catagory: "category",
  cieling: "ceiling", collegue: "colleague", comming: "coming", commited: "committed",
  compeltely: "completely", concious: "conscious", definately: "definitely",
  dependant: "dependent", didnt: "didn't", diffrent: "different", dilema: "dilemma",
  dissapear: "disappear", dissapoint: "disappoint", doesnt: "doesn't", dont: "don't",
  embarass: "embarrass", enviroment: "environment", equiped: "equipped",
  everytime: "every time", excercise: "exercise", existance: "existence",
  experiance: "experience", explaination: "explanation", familar: "familiar",
  Febuary: "February", finaly: "finally", foriegn: "foreign", freind: "friend",
  fro: "for", fromt: "from", garantee: "guarantee", gaurd: "guard",
  goverment: "government", grammer: "grammar", hadnt: "hadn't", happend: "happened",
  harrass: "harass", hasnt: "hasn't", havent: "haven't", heirarchy: "hierarchy",
  hte: "the", hten: "then", htis: "this", immediatly: "immediately",
  independant: "independent", inteligent: "intelligent", interupt: "interrupt",
  isnt: "isn't", knowlege: "knowledge", liason: "liaison", libary: "library",
  maintenence: "maintenance", managment: "management", millenium: "millennium",
  mispell: "misspell", neccessary: "necessary", necesary: "necessary",
  negotiable: "negotiable", noticable: "noticeable", occassion: "occasion",
  occured: "occurred", occuring: "occurring", ocurred: "occurred",
  opinon: "opinion", oppurtunity: "opportunity", paralell: "parallel",
  particularily: "particularly", perseverence: "perseverance", personnal: "personal",
  posession: "possession", possibile: "possible", potatoe: "potato",
  preffered: "preferred", privilage: "privilege", probaly: "probably",
  proffesional: "professional", pubilc: "public", publically: "publicly",
  quater: "quarter", questionaire: "questionnaire", readible: "readable",
  realy: "really", reccomend: "recommend", reccommend: "recommend",
  recieve: "receive", recieved: "received", refered: "referred", refering: "referring",
  relevent: "relevant", religous: "religious", remeber: "remember",
  responsability: "responsibility", rythm: "rhythm", secratary: "secretary",
  seperate: "separate", seperated: "separated", seperately: "separately",
  sieze: "seize", similiar: "similar", sincerly: "sincerely", speach: "speech",
  succesful: "successful", successfull: "successful", supercede: "supersede",
  suprise: "surprise", teh: "the", tehn: "then", tempature: "temperature",
  therefor: "therefore", thier: "their", threshhold: "threshold",
  tommorow: "tomorrow", tommorrow: "tomorrow", tounge: "tongue", truely: "truly",
  twelth: "twelfth", tyhe: "the", underate: "underrate", untill: "until",
  unuseual: "unusual", vaccum: "vacuum", vegatables: "vegetables",
  wasnt: "wasn't", wich: "which", wierd: "weird", wihch: "which", wont: "won't",
  woudl: "would", writting: "writing", yeild: "yield", youre: "you're",
};

const WORD_BOUNDARY = /[\s.,;:!?)\]}"'’”]/;
const SENTENCE_END = /[.!?]/;

/** Abbreviations that end in a period without ending a sentence. */
const NON_TERMINAL = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
  "eg", "ie", "no", "vol", "fig", "al", "inc", "ltd", "co", "approx",
]);

/**
 * True when the offset sits at the start of a sentence.
 *
 * Walks back over whitespace, then over any opening quote or bracket, and
 * decides on what it finds: the start of the document, a blank line, or
 * terminal punctuation that is not an abbreviation.
 */
export function startsSentence(text: string, offset: number): boolean {
  // A new block always starts a sentence, whatever came before it. Checked
  // first because the walk below stops at the block marker itself: from the
  // "item" in "intro\n- item" it never reaches the line break.
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  if (/^\s*(?:#{1,6}\s+|[-*+]\s+|\d{1,9}[.)]\s+|>\s?)+["'“‘(\[]*$/.test(prefix)) return true;

  let i = offset - 1;
  let sawNewline = false;

  while (i >= 0 && /[\s"'“‘(\[]/.test(text[i])) {
    if (text[i] === "\n") {
      if (sawNewline) return true;
      sawNewline = true;
    }
    i -= 1;
  }
  if (i < 0) return true;
  if (!SENTENCE_END.test(text[i])) return false;
  if (text[i] !== ".") return true;

  let wordStart = i;
  while (wordStart > 0 && /[A-Za-z.]/.test(text[wordStart - 1])) wordStart -= 1;
  const word = text.slice(wordStart, i).toLowerCase();
  return !(NON_TERMINAL.has(word) || (word.length === 1 && /[a-z]/.test(word)));
}

function smartPunctuation(text: string, pos: number): Correction | null {
  const typed = text[pos - 1];

  if (typed === "." && text.slice(pos - 3, pos) === "..." && text[pos - 4] !== ".") {
    return { from: pos - 3, to: pos, insert: "…", rule: "ellipsis" };
  }

  if (typed === "-" && text[pos - 2] === "-" && text[pos - 3] !== "-") {
    const before = text[pos - 3];
    // A line of dashes is a rule or a table divider, not a dash between words.
    if (before !== undefined && before !== "\n" && !/[-|:]/.test(before)) {
      return { from: pos - 2, to: pos, insert: "—", rule: "em-dash" };
    }
    return null;
  }

  if (typed === '"') {
    const before = text[pos - 2];
    const opening = before === undefined || /[\s(\[{—–-]/.test(before);
    return { from: pos - 1, to: pos, insert: opening ? "“" : "”", rule: "double-quote" };
  }

  if (typed === "'") {
    const before = text[pos - 2];
    const opening = before === undefined || /[\s(\[{—–]/.test(before);
    return { from: pos - 1, to: pos, insert: opening ? "‘" : "’", rule: "single-quote" };
  }

  return null;
}

/**
 * Collapses a double space, but only where one is never wanted.
 *
 * Two spaces at the end of a line is a Markdown hard break, so the rule is
 * limited to a double space directly after terminal punctuation — the
 * typewriter habit — and leaves every other run of spaces alone.
 */
function collapseDoubleSpace(text: string, pos: number): Correction | null {
  if (text[pos - 1] !== " " || text[pos - 2] !== " ") return null;
  const before = text[pos - 3];
  if (before === undefined || !SENTENCE_END.test(before)) return null;
  return { from: pos - 2, to: pos - 1, insert: "", rule: "double-space" };
}

function wordCorrection(text: string, pos: number, options: AutoCorrectOptions): Correction | null {
  const boundary = text[pos - 1];
  if (boundary === undefined || !WORD_BOUNDARY.test(boundary)) return null;

  let end = pos - 1;
  // A closing quote may follow the word directly; step back over it.
  while (end > 0 && /["'’”)]/.test(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start -= 1;
  if (end <= start) return null;

  const word = text.slice(start, end);
  if (word.length === 0) return null;

  if (options.corrections) {
    // "I" on its own, always.
    if (word === "i") {
      return { from: start, to: end, insert: "I", rule: "pronoun-i" };
    }

    const replacement = TYPO_CORRECTIONS[word] ?? TYPO_CORRECTIONS[word.toLowerCase()];
    if (replacement && replacement !== word) {
      // Only one edit can be returned per keystroke, so the capitalization
      // decision has to be folded in here: otherwise "teh cat" at the start of
      // a paragraph becomes "the cat" and never gets its capital, because the
      // word boundary that would have triggered the rule has already been used.
      const capitalize = /^[A-Z]/.test(word) || startsSentence(text, start);
      const cased = capitalize
        ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
        : replacement;
      return { from: start, to: end, insert: cased, rule: "typo" };
    }

    // Sentence capitalization, and only for a word that is entirely lower
    // case — "iPhone" and "eBay" are spelled the way their owners spell them.
    if (/^[a-z]+$/.test(word) && startsSentence(text, start)) {
      return {
        from: start,
        to: start + 1,
        insert: word.charAt(0).toUpperCase(),
        rule: "capitalize",
      };
    }
  }

  return null;
}

/**
 * The single entry point: what, if anything, should change right now.
 *
 * `pos` is the caret immediately after the character the writer typed.
 * Returns at most one edit, because applying two at once would need the second
 * to be expressed against the first one's result.
 */
export function computeAutoCorrection(
  text: string,
  pos: number,
  options: AutoCorrectOptions,
): Correction | null {
  if (pos <= 0 || pos > text.length) return null;

  if (options.smartPunctuation) {
    const punctuation = smartPunctuation(text, pos);
    if (punctuation) return punctuation;
  }

  if (options.corrections) {
    const spacing = collapseDoubleSpace(text, pos);
    if (spacing) return spacing;
  }

  return wordCorrection(text, pos, options);
}
