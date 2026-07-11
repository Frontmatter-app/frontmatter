use std::path::Path;

const ZOLA_VERSION: &str = "0.19.2";

fn target_triple() -> String {
    std::env::var("TARGET").unwrap_or_else(|_| {
        let os = if cfg!(target_os = "macos") { "apple-darwin" }
            else if cfg!(target_os = "windows") { "pc-windows-msvc" }
            else { "unknown-linux-gnu" };
        let arch = if cfg!(target_arch = "aarch64") { "aarch64" }
            else { "x86_64" };
        format!("{}-{}", arch, os)
    })
}

fn zola_asset_name(triple: &str) -> String {
    format!("zola-v{}-{}.tar.gz", ZOLA_VERSION, triple)
}

fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") { "zola.exe" } else { "zola" }
}

fn download_zola() {
    let triple = target_triple();
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");

    let bin_path = out_dir.join(binary_name());
    if bin_path.exists() { return; }

    let asset = zola_asset_name(&triple);
    let url = format!(
        "https://github.com/getzola/zola/releases/download/v{}/{}",
        ZOLA_VERSION, asset
    );
    let tarball_path = out_dir.join(&asset);

    println!("cargo:warning=Downloading zola {} for {}...", ZOLA_VERSION, triple);
    println!("cargo:warning=URL: {}", url);

    let status = std::process::Command::new("curl")
        .args(["-fsSL", "-o"])
        .arg(&tarball_path)
        .arg(&url)
        .status()
        .expect("Failed to run curl; install curl or manually download zola");

    if !status.success() {
        panic!("Failed to download zola from {}", url);
    }

    let extract_dir = out_dir.join("_extract");
    std::fs::create_dir_all(&extract_dir).ok();

    let extract_status = std::process::Command::new("tar")
        .args(["-xzf", &tarball_path.to_string_lossy()])
        .current_dir(&extract_dir)
        .status()
        .expect("Failed to extract zola tarball");

    if !extract_status.success() {
        panic!("Failed to extract zola archive");
    }

    let extracted_bin = extract_dir.join(binary_name());
    if extracted_bin.exists() {
        std::fs::rename(&extracted_bin, &bin_path).ok();
    }

    std::fs::remove_dir_all(&extract_dir).ok();
    std::fs::remove_file(&tarball_path).ok();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&bin_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin_path, perms).ok();
        }
    }

    println!("cargo:warning=zola {} downloaded to {:?}", ZOLA_VERSION, bin_path);
}

fn main() {
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    std::fs::create_dir_all(&binaries_dir).ok();
    // create a placeholder so tauri resource glob doesn't fail
    let placeholder = binaries_dir.join(".gitkeep");
    if !binaries_dir.join("zola").exists() && !binaries_dir.join("zola.exe").exists() {
        std::fs::write(&placeholder, b"").ok();
    }

    tauri_build::build();

    if placeholder.exists() {
        std::fs::remove_file(&placeholder).ok();
    }
    download_zola();
}
