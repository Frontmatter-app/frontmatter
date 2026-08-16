use std::fs;
use std::path::Path;

/// Recursively copies `src` into `dst`, creating `dst` if needed.
///
/// Lifted out of `site::project` so the theme scaffolder can reuse it.
pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Lowercases, collapses separators, and strips anything that cannot appear in
/// a directory name — so a theme name typed by a user is safe to `join`.
pub fn slugify(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut pending_sep = false;

    for c in raw.chars() {
        if c.is_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('-');
            }
            pending_sep = false;
            out.extend(c.to_lowercase());
        } else {
            pending_sep = true;
        }
    }

    out
}
