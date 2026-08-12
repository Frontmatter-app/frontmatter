//! Fence-aware Markdown scanning.
//!
//! Heading extraction used to be duplicated in `discover::docs` and
//! `normalize::headings`, and neither copy tracked fenced code blocks — so a
//! `# comment` inside a Python block became a top-level heading in the exported
//! table of contents. Both call sites now share this scanner.

/// A heading found in the document body: `(level, text)`.
pub type Heading = (i32, String);

/// Returns true once the line opens or closes a fenced code block, updating
/// `fence` in place. `fence` holds the open fence's marker char and width.
fn toggle_fence(line: &str, fence: &mut Option<(char, usize)>) -> bool {
    let trimmed = line.trim_start();
    let marker = match trimmed.chars().next() {
        Some(c @ ('`' | '~')) => c,
        _ => return false,
    };
    let width = trimmed.chars().take_while(|c| *c == marker).count();
    if width < 3 {
        return false;
    }

    match *fence {
        // A closing fence uses the same marker and is at least as wide, and
        // carries no info string.
        Some((open_marker, open_width)) => {
            if marker == open_marker
                && width >= open_width
                && trimmed[width..].trim().is_empty()
            {
                *fence = None;
            }
            true
        }
        None => {
            *fence = Some((marker, width));
            true
        }
    }
}

/// Extracts ATX headings, skipping anything inside a fenced code block.
///
/// A heading is `#`-`######` followed by a space, so `#hashtag` is body text.
pub fn heading_lines(md: &str) -> Vec<Heading> {
    let mut fence: Option<(char, usize)> = None;
    let mut out = Vec::new();

    for line in md.lines() {
        if toggle_fence(line, &mut fence) {
            continue;
        }
        if fence.is_some() {
            continue;
        }

        let trimmed = line.trim();
        let level = trimmed.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 {
            continue;
        }
        let rest = &trimmed[level..];
        if !rest.starts_with(' ') {
            continue;
        }
        let text = rest.trim();
        if text.is_empty() {
            continue;
        }
        out.push((level as i32, text.to_string()));
    }

    out
}

/// First level-1 heading in the body, if any.
pub fn first_h1(md: &str) -> Option<String> {
    heading_lines(md)
        .into_iter()
        .find(|(level, _)| *level == 1)
        .map(|(_, text)| text)
}

/// All level-2 headings in the body.
pub fn all_h2s(md: &str) -> Vec<String> {
    heading_lines(md)
        .into_iter()
        .filter(|(level, _)| *level == 2)
        .map(|(_, text)| text)
        .collect()
}

/// Returns body lines with fenced code blocks removed. Used by extractors that
/// must not treat code contents as prose (images, links).
pub fn prose_lines(md: &str) -> Vec<&str> {
    let mut fence: Option<(char, usize)> = None;
    let mut out = Vec::new();
    for line in md.lines() {
        if toggle_fence(line, &mut fence) {
            continue;
        }
        if fence.is_none() {
            out.push(line);
        }
    }
    out
}

/// Info strings of every fenced code block, lowercased and deduped.
pub fn fence_languages(md: &str) -> Vec<String> {
    let mut fence: Option<(char, usize)> = None;
    let mut langs: Vec<String> = Vec::new();

    for line in md.lines() {
        let was_open = fence.is_some();
        if toggle_fence(line, &mut fence) {
            // Only an opening fence carries an info string.
            if !was_open && fence.is_some() {
                let trimmed = line.trim_start();
                let marker = trimmed.chars().next().unwrap();
                let width = trimmed.chars().take_while(|c| *c == marker).count();
                let info = trimmed[width..].trim();
                let lang = info.split_whitespace().next().unwrap_or("");
                if !lang.is_empty() {
                    langs.push(lang.to_lowercase());
                }
            }
        }
    }

    langs.sort();
    langs.dedup();
    langs
}
