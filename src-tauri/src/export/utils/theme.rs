use crate::export::types::{ProjectType, ThemeOption};
use crate::export::utils::title::default_theme_name;
use std::fs;
use std::path::{Path, PathBuf};

fn read_theme_metadata(theme_dir: &Path) -> (String, String) {
    let theme_toml = theme_dir.join("theme.toml");
    let Ok(content) = fs::read_to_string(&theme_toml) else {
        return (default_theme_name(theme_dir), String::new());
    };

    let field = |key: &str| -> Option<String> {
        content
            .lines()
            .find(|l| l.trim().starts_with(&format!("{key} =")))
            .and_then(|l| l.split_once('='))
            .map(|(_, v)| v.trim().trim_matches('"').to_string())
            .filter(|s| !s.is_empty())
    };

    (
        field("name").unwrap_or_else(|| default_theme_name(theme_dir)),
        field("description").unwrap_or_default(),
    )
}

/// Ordered search path for themes of one project type.
///
/// The workspace wins over the bundled themes so a user can override a shipped
/// theme by name, and the bundled root is searched twice: once scoped to the
/// project type, once unscoped so the shared `base` theme is reachable from
/// every target.
pub struct ThemeRoots {
    roots: Vec<PathBuf>,
}

impl ThemeRoots {
    pub fn new(workspace: &Path, bundled: Option<&Path>, project_type: ProjectType) -> Self {
        let mut roots = vec![
            workspace.join("themes").join(project_type.slug()),
            workspace.join("themes"),
        ];
        if let Some(b) = bundled {
            roots.push(b.join(project_type.slug()));
            roots.push(b.to_path_buf());
        }
        Self { roots }
    }

    /// Directory backing `id`, or `None` when no root provides it.
    pub fn resolve(&self, id: &str) -> Option<PathBuf> {
        if id.is_empty() {
            return None;
        }
        self.roots
            .iter()
            .map(|root| root.join(id))
            .find(|candidate| candidate.is_dir())
    }

    /// Themes available for this target.
    ///
    /// Every entry is backed by a directory that exists and carries templates,
    /// so anything offered to the user is guaranteed to resolve and render.
    /// Previously a synthetic `base` entry was always prepended even when no
    /// such directory existed, producing an export with no templates at all.
    pub fn list(&self) -> Vec<ThemeOption> {
        let mut options: Vec<ThemeOption> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        for root in &self.roots {
            let Ok(entries) = fs::read_dir(root) else { continue };
            let mut in_root: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            in_root.sort();

            for path in in_root {
                let Some(id) = path.file_name().and_then(|n| n.to_str()) else { continue };
                // A project-type directory is a container of themes, not a theme.
                if ProjectType::all().iter().any(|t| t.slug() == id) {
                    continue;
                }
                // A directory with no templates cannot render a site, so it is
                // not a theme — `themes/skills/`, scratch folders, and the like.
                if !path.join("templates").is_dir() {
                    continue;
                }
                if !seen.insert(id.to_string()) {
                    continue;
                }
                let (name, description) = read_theme_metadata(&path);
                options.push(ThemeOption {
                    id: id.to_string(),
                    name,
                    description,
                    preview_type: "html".to_string(),
                });
            }
        }

        // Keep the built-in default first when present.
        options.sort_by_key(|o| (o.id != "base", o.id.clone()));
        options
    }
}

pub fn list_themes(workspace_path: &Path, project_type: ProjectType) -> Vec<ThemeOption> {
    ThemeRoots::new(workspace_path, None, project_type).list()
}

/// Resolves a theme id to its directory.
///
/// Returns a non-existent path when the id cannot be resolved; callers must
/// check, and [`ThemeRoots::list`] guarantees ids it produced will resolve.
pub fn get_theme_dir(theme_name: &str, workspace_path: &Path, project_type: ProjectType) -> PathBuf {
    let roots = ThemeRoots::new(workspace_path, None, project_type);
    roots.resolve(theme_name).unwrap_or_else(|| {
        workspace_path
            .join("themes")
            .join(project_type.slug())
            .join(theme_name)
    })
}
