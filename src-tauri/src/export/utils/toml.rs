/// Escapes a string for use inside a TOML basic string (`"..."`).
///
/// Control characters must be escaped, not passed through: excerpts come
/// straight out of the documents table and a single raw newline turns the
/// generated frontmatter into a parse error that fails the whole build.
pub fn escape_toml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\u{:04X}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// A frontmatter block is key/value data. A run of non-empty lines that carries
/// no `key: value` / `key = value` / YAML list shape is body prose, which means
/// the opening delimiter was really a thematic break.
fn looks_like_frontmatter(body: &str) -> bool {
    let mut saw_content = false;
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        saw_content = true;
        let is_data = t.contains(':')
            || t.contains('=')
            || t.starts_with('-')
            || t.starts_with('#')
            || t.starts_with('[');
        if !is_data {
            return false;
        }
    }
    saw_content
}

fn try_strip<'a>(content: &'a str, delim: &str) -> Option<&'a str> {
    let offset = content.len() - content.trim_start().len();
    let trimmed = &content[offset..];

    let mut lines = trimmed.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim_end() != delim {
        return None;
    }

    let body_start = first.len();
    let mut pos = body_start;

    for line in lines {
        if line.trim_end() == delim {
            if !looks_like_frontmatter(&trimmed[body_start..pos]) {
                return None;
            }
            let after = pos + line.len();
            return Some(trimmed[after..].trim_start_matches(['\n', '\r']));
        }
        pos += line.len();
    }

    // No closing delimiter: this is not frontmatter, leave the document alone.
    None
}

/// Removes a leading YAML (`---`) or TOML (`+++`) frontmatter block.
///
/// Returns `content` unchanged when there is no frontmatter, when the block is
/// unterminated, or when the opening delimiter is really a thematic break.
pub fn strip_frontmatter(content: &str) -> &str {
    try_strip(content, "---")
        .or_else(|| try_strip(content, "+++"))
        .unwrap_or(content)
}
