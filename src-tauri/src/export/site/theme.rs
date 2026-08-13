//! Theme resolution lives in `utils::theme`; this module only re-exports it.
//!
//! It previously held three hand-written wrapper functions that forwarded their
//! arguments unchanged.

// `get_theme_dir` is exercised by the export tests; the runtime path uses
// `ThemeRoots` directly.
#[allow(unused_imports)]
pub use crate::export::utils::theme::{get_theme_dir, ThemeRoots};
