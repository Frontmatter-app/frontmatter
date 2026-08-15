//! Grammar and spelling, in process.
//!
//! Vale checks *style* — house rules, banned words, inclusive language. The
//! readability analysis in the editor checks *shape* — sentence length, voice,
//! wordiness. Neither of them checks grammar, which is the one thing every
//! writer expects an editor to catch.
//!
//! Harper fills that gap without the usual cost. It is a Rust library, so this
//! is a function call rather than a process spawn: no binary to locate, no
//! stdin plumbing, no JSON round trip, and no config tree to stage on disk. It
//! runs entirely offline, so nothing a writer types leaves the machine.

use harper_core::linting::{LintGroup, LintKind, Linter, Suggestion};
use harper_core::spell::FstDictionary;
use harper_core::{Dialect, Document};
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarLint {
    /// UTF-16 offset from the start of the document, inclusive.
    pub start: usize,
    /// UTF-16 offset from the start of the document, exclusive.
    pub end: usize,
    pub message: String,
    /// Harper's own category, lower-cased. Shown as the rule name.
    pub kind: String,
    /// "error" | "warning" | "suggestion", decided by category.
    pub severity: &'static str,
    /// Concrete replacements, best first. Empty when the fix is not mechanical.
    pub suggestions: Vec<String>,
}

/// Categories the editor already covers, and which would double up.
///
/// Harper reports readability and stylistic "enhancement" lints of its own.
/// Those are exactly the ground the readability analysis stands on, and two
/// highlights for one problem is the thing this whole pass set out to remove.
fn is_duplicate_of_readability(kind: LintKind) -> bool {
    matches!(
        kind,
        LintKind::Readability | LintKind::Enhancement | LintKind::Style
    )
}

fn kind_name(kind: LintKind) -> String {
    format!("{:?}", kind).to_lowercase()
}

/// How loudly to report a category.
///
/// An exhaustive `match` on purpose. The first version of this lived in
/// TypeScript as a lookup table with a default, and three of Harper's
/// categories — `WordChoice`, `Usage` and `WordOrder` — were simply missing
/// from it, so "could of gone" was filed as a gentle suggestion. Written here,
/// a Harper release that adds a category fails the build instead of quietly
/// downgrading whatever it covers.
fn severity_for(kind: LintKind) -> &'static str {
    match kind {
        // Plainly wrong.
        LintKind::Agreement
        | LintKind::BoundaryError
        | LintKind::Grammar
        | LintKind::Malapropism
        | LintKind::Spelling
        | LintKind::Typo
        | LintKind::Usage
        | LintKind::WordChoice
        | LintKind::WordOrder => "error",

        // Wrong in most contexts, defensible in some.
        LintKind::Capitalization
        | LintKind::Eggcorn
        | LintKind::Nonstandard
        | LintKind::Punctuation
        | LintKind::Redundancy
        | LintKind::Repetition => "warning",

        // A matter of preference or house convention.
        LintKind::Formatting | LintKind::Miscellaneous | LintKind::Regionalism => "suggestion",

        // Filtered out before this is reached; listed so the match stays
        // exhaustive without a catch-all arm.
        LintKind::Readability | LintKind::Enhancement | LintKind::Style => "suggestion",
    }
}

/// The linter, built once.
///
/// Loading the curated dictionary parses a finite-state transducer of the whole
/// English lexicon. Doing that per keystroke would cost more than the linting.
/// `lint` takes `&mut self` for its internal caches, hence the mutex.
static LINTER: OnceLock<Mutex<LintGroup>> = OnceLock::new();

fn linter() -> &'static Mutex<LintGroup> {
    LINTER.get_or_init(|| {
        Mutex::new(LintGroup::new_curated(
            FstDictionary::curated(),
            Dialect::American,
        ))
    })
}

/// Maps char offsets onto UTF-16 offsets.
///
/// Harper counts in Unicode scalar values; JavaScript counts in UTF-16 code
/// units. One emoji in a paragraph puts every offset after it out by one, and
/// a highlight that is out by one is a highlight on the wrong word. Converting
/// here rather than in TypeScript keeps the front end free of the distinction
/// entirely — every offset that crosses the boundary is already UTF-16.
fn utf16_offsets(text: &str) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(text.chars().count() + 1);
    let mut total = 0;
    for ch in text.chars() {
        offsets.push(total);
        total += ch.len_utf16();
    }
    offsets.push(total);
    offsets
}

fn run(text: &str) -> Result<Vec<GrammarLint>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let document = Document::new_markdown_default_curated(text);
    let lints = {
        let mut group = linter()
            .lock()
            .map_err(|e| format!("Grammar linter lock poisoned: {}", e))?;
        group.lint(&document)
    };

    let offsets = utf16_offsets(text);
    let last = offsets.len() - 1;

    Ok(lints
        .into_iter()
        .filter(|lint| !is_duplicate_of_readability(lint.lint_kind))
        .filter_map(|lint| {
            let start_char = lint.span.start.min(last);
            let end_char = lint.span.end.min(last);
            if end_char <= start_char {
                return None;
            }

            let suggestions = lint
                .suggestions
                .iter()
                .filter_map(|suggestion| match suggestion {
                    Suggestion::ReplaceWith(chars) => Some(chars.iter().collect::<String>()),
                    // "Remove this text" is a replacement with nothing, which
                    // the editor applies the same way.
                    Suggestion::Remove => Some(String::new()),
                    // An insertion is not a replacement of the flagged span, so
                    // offering it as one would corrupt the text.
                    Suggestion::InsertAfter(_) => None,
                })
                .collect();

            Some(GrammarLint {
                start: offsets[start_char],
                end: offsets[end_char],
                message: lint.message,
                kind: kind_name(lint.lint_kind),
                severity: severity_for(lint.lint_kind),
                suggestions,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn check_grammar(text: String) -> Result<Vec<GrammarLint>, String> {
    // Linting is CPU-bound and a long document is not instant. Off the async
    // runtime's worker threads, so a scan cannot stall unrelated commands.
    tokio::task::spawn_blocking(move || run(&text))
        .await
        .map_err(|e| format!("Grammar check panicked: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages(text: &str) -> Vec<String> {
        run(text)
            .unwrap()
            .into_iter()
            .map(|lint| format!("{}:{}", lint.kind, &text[lint.start..lint.end]))
            .collect()
    }

    /// Every input here was verified against Harper directly.
    ///
    /// The rules need more context than a minimal example gives: Harper does
    /// not flag "Their going home." but does flag the same mistake in a longer
    /// sentence, and it wants a recognisable sentence after a full stop before
    /// calling a lower-case start a mistake. So these are real sentences, not
    /// reductions of them.
    #[test]
    fn catches_the_mistakes_a_rule_can_describe() {
        let cases: [(&str, &str); 6] = [
            ("This is wrongs and I like it. what do you think these does?", "capitalization"),
            ("She dont know.", "spelling"),
            ("This is is a sentence with teh repeated word.", "repetition"),
            ("I has a apple and a orange.", "agreement"),
            ("Their going to there house over they're.", "grammar"),
            ("He could of gone.", "wordchoice"),
        ];
        for (text, expected) in cases {
            let found = messages(text);
            assert!(
                found.iter().any(|m| m.starts_with(expected)),
                "expected a {} lint in {:?}, got {:?}",
                expected,
                text,
                found
            );
        }
    }

    /// Documents the ceiling, so nobody re-reports it as a bug.
    ///
    /// Harper is a rule engine, not a parser with a grammar model. It knows
    /// several hundred specific, enumerable mistakes; it does not work out
    /// subject-verb agreement from sentence structure. "The cat are sleeping"
    /// is perfectly ordinary English words in an order no rule lists, so
    /// nothing fires. No offline rule-based checker will catch this class.
    #[test]
    fn does_not_catch_agreement_that_needs_a_grammar_model() {
        assert!(run("The cat are sleeping.").unwrap().is_empty());
    }

    #[test]
    fn word_choice_is_an_error_rather_than_a_gentle_suggestion() {
        let lints = run("He could of gone.").unwrap();
        let word_choice = lints.iter().find(|l| l.kind == "wordchoice").unwrap();
        assert_eq!(word_choice.severity, "error");
    }

    #[test]
    fn every_category_is_graded_explicitly() {
        // Not a tautology: `severity_for` is an exhaustive match, so this fails
        // to compile rather than to run if Harper adds a category. This asserts
        // the grades themselves are the ones intended.
        assert_eq!(severity_for(LintKind::Spelling), "error");
        assert_eq!(severity_for(LintKind::Usage), "error");
        assert_eq!(severity_for(LintKind::WordOrder), "error");
        assert_eq!(severity_for(LintKind::Capitalization), "warning");
        assert_eq!(severity_for(LintKind::Regionalism), "suggestion");
    }

    #[test]
    fn utf16_offsets_match_javascript_string_indices() {
        // "🎉" is one char and two UTF-16 code units.
        let offsets = utf16_offsets("a🎉b");
        assert_eq!(offsets, vec![0, 1, 3, 4]);
    }

    #[test]
    fn utf16_offsets_are_identity_for_ascii() {
        assert_eq!(utf16_offsets("abc"), vec![0, 1, 2, 3]);
    }

    #[test]
    fn empty_text_produces_no_lints() {
        assert!(run("").unwrap().is_empty());
        assert!(run("   \n  ").unwrap().is_empty());
    }

    #[test]
    fn readability_kinds_are_left_to_the_editor() {
        assert!(is_duplicate_of_readability(LintKind::Readability));
        assert!(is_duplicate_of_readability(LintKind::Enhancement));
        assert!(!is_duplicate_of_readability(LintKind::Grammar));
        assert!(!is_duplicate_of_readability(LintKind::Spelling));
        assert!(!is_duplicate_of_readability(LintKind::Capitalization));
    }

    #[test]
    fn finds_a_repeated_word_and_points_at_it() {
        let text = "This is is a sentence.";
        let lints = run(text).unwrap();
        assert!(
            !lints.is_empty(),
            "expected a lint for a doubled word, got none"
        );
        // Every span must be inside the document and non-empty.
        for lint in &lints {
            assert!(lint.start < lint.end);
            assert!(lint.end <= text.encode_utf16().count());
        }
    }

    #[test]
    fn spans_stay_correct_after_a_multi_byte_character() {
        let text = "🎉 Their is a mistake here.";
        let utf16_len = text.encode_utf16().count();
        for lint in run(text).unwrap() {
            assert!(lint.end <= utf16_len);
            assert!(lint.start < lint.end);
        }
    }
}
