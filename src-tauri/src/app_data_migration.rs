//! Carries a previous install's data across a change of bundle identifier.
//!
//! The webview's storage lives in a directory named after the bundle
//! identifier, so renaming the app from `com.marktype.dev` to
//! `com.frontmatter.app` would otherwise start every existing install from
//! nothing: signed out, settings reset, open tabs and custom theme gone. None
//! of that is in the workspace databases — those live beside the user's files
//! and are unaffected — but all of it is in local storage, and local storage
//! moves with the identifier.
//!
//! This runs from `main` before Tauri is built rather than from the `setup`
//! hook, because the webview reads its storage directory as it is created and
//! the ordering of `setup` against window creation is not something worth
//! depending on.

use std::fs;
use std::path::{Path, PathBuf};

/// The identifier every release before the rename shipped with.
const LEGACY_IDENTIFIER: &str = "com.marktype.dev";

/// The identifier in `tauri.conf.json`. Kept in step by a test below.
const CURRENT_IDENTIFIER: &str = "com.frontmatter.app";

/// Where per-application data directories live on this platform.
///
/// Mirrors Tauri's own resolution so the directory computed here is the one
/// the webview will actually open.
fn app_data_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|home| home.join("Library").join("Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::config_dir()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs::data_dir()
    }
}

fn copy_dir_all(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dest.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)?;
        }
        // Symlinks are skipped deliberately: nothing the webview stores is a
        // link, and following one would copy from outside the source tree.
    }
    Ok(())
}

/// Copies the previous install's data directory across, once.
///
/// Copies rather than moves, so a failure part-way through cannot destroy the
/// old install's data and the previous version still runs. Returns whether a
/// migration was performed, which is only of interest to the tests and the log
/// line.
pub fn migrate_legacy_app_data() -> bool {
    let Some(root) = app_data_root() else {
        return false;
    };
    migrate_between(&root.join(LEGACY_IDENTIFIER), &root.join(CURRENT_IDENTIFIER))
}

/// The decision and the copy, with the paths handed in so it can be tested.
pub fn migrate_between(legacy: &Path, current: &Path) -> bool {
    // A directory for the new identifier means this install has already run —
    // either it migrated before, or it is a fresh install with its own state.
    // Copying over it either way would overwrite newer data with older.
    if current.exists() {
        return false;
    }
    if !legacy.is_dir() {
        return false;
    }

    match copy_dir_all(legacy, current) {
        Ok(()) => true,
        Err(error) => {
            // A failed migration is not a failed launch. The app starts with
            // empty state, which is recoverable by signing in again; refusing
            // to start is not.
            eprintln!(
                "Could not carry data over from the previous version ({:?} -> {:?}): {}",
                legacy, current, error
            );
            // Leave nothing half-copied behind to be mistaken for real state.
            let _ = fs::remove_dir_all(current);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique scratch directory, so the tests do not collide when run in
    /// parallel and do not touch the real application-support directory.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "frontmatter-migration-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_current_identifier_matches_the_tauri_config() {
        let config = include_str!("../tauri.conf.json");
        assert!(
            config.contains(CURRENT_IDENTIFIER),
            "tauri.conf.json identifier and CURRENT_IDENTIFIER have drifted; \
             a mismatch silently migrates into a directory nothing reads"
        );
    }

    #[test]
    fn copies_a_previous_install_across() {
        let root = scratch("copies");
        let legacy = root.join("old");
        fs::create_dir_all(legacy.join("Local Storage")).unwrap();
        fs::write(legacy.join("Local Storage").join("data"), b"settings").unwrap();

        let current = root.join("new");
        assert!(migrate_between(&legacy, &current));
        assert_eq!(
            fs::read(current.join("Local Storage").join("data")).unwrap(),
            b"settings"
        );
    }

    #[test]
    fn leaves_the_previous_install_intact() {
        let root = scratch("nondestructive");
        let legacy = root.join("old");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("file"), b"x").unwrap();

        migrate_between(&legacy, &root.join("new"));
        assert!(legacy.join("file").exists(), "the old install must still run");
    }

    #[test]
    fn does_nothing_when_the_app_already_has_data() {
        let root = scratch("existing");
        let legacy = root.join("old");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("file"), b"old").unwrap();

        let current = root.join("new");
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join("file"), b"new").unwrap();

        assert!(!migrate_between(&legacy, &current));
        assert_eq!(fs::read(current.join("file")).unwrap(), b"new");
    }

    #[test]
    fn does_nothing_for_a_fresh_install() {
        let root = scratch("fresh");
        assert!(!migrate_between(&root.join("absent"), &root.join("new")));
        assert!(!root.join("new").exists());
    }

    #[test]
    fn runs_only_once() {
        let root = scratch("idempotent");
        let legacy = root.join("old");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("file"), b"original").unwrap();

        let current = root.join("new");
        assert!(migrate_between(&legacy, &current));

        // The user changes something, then relaunches.
        fs::write(current.join("file"), b"changed").unwrap();
        assert!(!migrate_between(&legacy, &current));
        assert_eq!(fs::read(current.join("file")).unwrap(), b"changed");
    }

    #[test]
    fn copies_nested_directories() {
        let root = scratch("nested");
        let legacy = root.join("old");
        fs::create_dir_all(legacy.join("a").join("b").join("c")).unwrap();
        fs::write(legacy.join("a").join("b").join("c").join("deep"), b"v").unwrap();

        let current = root.join("new");
        assert!(migrate_between(&legacy, &current));
        assert!(current.join("a").join("b").join("c").join("deep").exists());
    }
}
