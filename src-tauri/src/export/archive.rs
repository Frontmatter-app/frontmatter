use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

/// Zips the built site at `public_dir` into `destination`.
///
/// Paths inside the archive are relative to `public_dir`, so unzipping yields
/// `index.html` at the top level — ready to drag onto any static host.
pub fn zip_directory(public_dir: &Path, destination: &Path) -> Result<usize, String> {
    if !public_dir.is_dir() {
        return Err(
            "No built site was found. Publish once before saving a .zip.".to_string(),
        );
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }

    let file = fs::File::create(destination)
        .map_err(|e| format!("Failed to create {}: {e}", destination.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut file_count = 0usize;
    let mut buffer = Vec::new();

    for entry in collect_entries(public_dir)? {
        let relative = entry
            .strip_prefix(public_dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            // Zip entries always use forward slashes, including on Windows.
            .replace('\\', "/");

        if entry.is_dir() {
            zip.add_directory(format!("{relative}/"), options)
                .map_err(|e| e.to_string())?;
            continue;
        }

        zip.start_file(&relative, options).map_err(|e| e.to_string())?;
        buffer.clear();
        fs::File::open(&entry)
            .and_then(|mut f| f.read_to_end(&mut buffer))
            .map_err(|e| format!("Failed to read {}: {e}", entry.display()))?;
        zip.write_all(&buffer)
            .map_err(|e| format!("Failed to write {relative} into the archive: {e}"))?;
        file_count += 1;
    }

    zip.finish().map_err(|e| format!("Failed to finalise the archive: {e}"))?;

    if file_count == 0 {
        return Err("The built site is empty. Publish again before saving a .zip.".to_string());
    }

    Ok(file_count)
}

/// Every path under `root`, depth-first, excluding `root` itself.
fn collect_entries(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            out.push(path);
        }
    }

    out.sort();
    Ok(out)
}
