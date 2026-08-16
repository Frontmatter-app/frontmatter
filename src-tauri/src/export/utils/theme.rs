use crate::export::types::{ProjectType, ThemeOption, ThemeOptionField, ThemeSource};
use crate::export::utils::title::default_theme_name;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Screenshot filename assumed when `theme.toml` does not name one.
const DEFAULT_SCREENSHOT: &str = "screenshot.png";

/// `theme.toml`, in full.
///
/// Every field is optional. A theme is a directory containing `templates/`;
/// the manifest only decorates it, so a theme without one — or with one this
/// parser cannot read — still lists and still builds.
#[derive(Debug, Default, Deserialize)]
struct ThemeManifest {
    name: Option<String>,
    description: Option<String>,
    #[allow(dead_code)]
    license: Option<String>,
    screenshot: Option<String>,
    author: Option<ManifestAuthor>,
    extra: Option<ManifestExtra>,
}

#[derive(Debug, Default, Deserialize)]
struct ManifestAuthor {
    name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ManifestExtra {
    #[serde(default)]
    options: Vec<ThemeOptionField>,
}

/// Everything the picker shows about a theme directory.
struct ThemeMetadata {
    name: String,
    description: String,
    author: Option<String>,
    screenshot: Option<String>,
    options: Vec<ThemeOptionField>,
}

/// Reads and parses `theme.toml`.
///
/// This used to scan lines for `key =` prefixes, which could not see into
/// `[author]` or `[[extra.options]]` and mistook any indented match for a
/// top-level key. A malformed or absent manifest yields defaults rather than
/// hiding the theme.
fn read_theme_metadata(theme_dir: &Path) -> ThemeMetadata {
    let manifest = fs::read_to_string(theme_dir.join("theme.toml"))
        .ok()
        .and_then(|content| match toml::from_str::<ThemeManifest>(&content) {
            Ok(parsed) => Some(parsed),
            Err(e) => {
                tracing::warn!(
                    theme = %theme_dir.display(),
                    error = %e,
                    "theme.toml could not be parsed; falling back to defaults",
                );
                None
            }
        })
        .unwrap_or_default();

    ThemeMetadata {
        name: manifest
            .name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| default_theme_name(theme_dir)),
        description: manifest.description.unwrap_or_default(),
        author: manifest.author.and_then(|a| a.name).filter(|s| !s.trim().is_empty()),
        screenshot: resolve_screenshot(theme_dir, manifest.screenshot.as_deref()),
        options: manifest.extra.map(|e| e.options).unwrap_or_default(),
    }
}

/// Absolute path to the theme's preview image, when one exists on disk.
///
/// A declared path that does not exist falls back to the conventional
/// `screenshot.png` so a typo in the manifest does not silently blank the card.
fn resolve_screenshot(theme_dir: &Path, declared: Option<&str>) -> Option<String> {
    let candidates = declared
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .into_iter()
        .chain(std::iter::once(DEFAULT_SCREENSHOT));

    for candidate in candidates {
        // A manifest cannot reach outside its own directory.
        if candidate.contains("..") || Path::new(candidate).is_absolute() {
            continue;
        }
        let path = theme_dir.join(candidate);
        if path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

/// One root in the theme search path, tagged with where it came from.
struct Root {
    path: PathBuf,
    source: ThemeSource,
}

/// Ordered search path for themes of one project type.
///
/// The workspace wins over the bundled themes so a user can override a shipped
/// theme by name. Both roots are searched twice — once scoped to the project
/// type, once unscoped — so a theme placed directly in `themes/` is offered for
/// every target rather than having to be copied per type.
pub struct ThemeRoots {
    roots: Vec<Root>,
}

impl ThemeRoots {
    pub fn new(workspace: &Path, bundled: Option<&Path>, project_type: ProjectType) -> Self {
        let mut roots = vec![
            Root {
                path: workspace.join("themes").join(project_type.slug()),
                source: ThemeSource::Workspace,
            },
            Root {
                path: workspace.join("themes"),
                source: ThemeSource::Workspace,
            },
        ];
        if let Some(b) = bundled {
            roots.push(Root {
                path: b.join(project_type.slug()),
                source: ThemeSource::Bundled,
            });
            roots.push(Root {
                path: b.to_path_buf(),
                source: ThemeSource::Bundled,
            });
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
            .map(|root| root.path.join(id))
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
            let Ok(entries) = fs::read_dir(&root.path) else { continue };
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
                // not a theme — `themes/_shared/`, scratch folders, and the like.
                if !path.join("templates").is_dir() {
                    continue;
                }
                if !seen.insert(id.to_string()) {
                    continue;
                }
                let meta = read_theme_metadata(&path);
                options.push(ThemeOption {
                    id: id.to_string(),
                    name: meta.name,
                    description: meta.description,
                    preview_type: "html".to_string(),
                    screenshot: meta.screenshot,
                    source: root.source,
                    author: meta.author,
                    options: meta.options,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }

        // The shipped flagship for a type is `default`; anything the user adds
        // sorts after it by name.
        options.sort_by_key(|o| (o.id != "default", o.name.to_lowercase()));
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
