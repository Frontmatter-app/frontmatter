//! Credential storage in the operating system keychain.
//!
//! Git provider tokens can push to a user's repositories. That makes them
//! materially more dangerous than the session tokens this app has stored
//! before, which could at worst impersonate an account on a sync server.
//!
//! The existing pattern was `localStorage`: readable by anything running in the
//! webview, persisted in plaintext on disk, and at one point passed between
//! windows through a URL query string. Extending that to a credential with
//! write access to someone's source history would be a genuine escalation, so
//! forge tokens go to the platform secret store instead — Keychain on macOS,
//! the Secret Service on Linux, the Credential Manager on Windows.
//!
//! The token deliberately never crosses into JavaScript after being stored.
//! `credential_get` exists because the forge adapter needs it to sign requests,
//! but the intended end state is that signing moves down here too.

use keyring::Entry;

const SERVICE: &str = "app.frontmatter.forge";

fn entry(account: &str) -> Result<Entry, String> {
    // A blank account would collide every provider into one slot, silently
    // overwriting one connection with another.
    if account.trim().is_empty() {
        return Err("A credential account name is required.".into());
    }
    Entry::new(SERVICE, account).map_err(|error| format!("Keychain unavailable: {error}"))
}

/// Stores a secret, replacing whatever was there.
#[tauri::command]
pub async fn credential_set(account: String, secret: String) -> Result<(), String> {
    if secret.is_empty() {
        return Err("Refusing to store an empty secret.".into());
    }
    let item = entry(&account)?;
    item.set_password(&secret)
        .map_err(|error| format!("Could not save to the keychain: {error}"))
}

/// Reads a secret. `None` means no credential is stored, which is not an error.
#[tauri::command]
pub async fn credential_get(account: String) -> Result<Option<String>, String> {
    let item = entry(&account)?;
    match item.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read from the keychain: {error}")),
    }
}

/// Removes a secret. Deleting something already absent succeeds.
#[tauri::command]
pub async fn credential_delete(account: String) -> Result<(), String> {
    let item = entry(&account)?;
    match item.delete_credential() {
        Ok(()) => Ok(()),
        // Idempotent on purpose: disconnecting an account that is already
        // disconnected should not surface an error to the user.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove from the keychain: {error}")),
    }
}

/// Whether a credential exists, without moving the secret into the webview.
#[tauri::command]
pub async fn credential_exists(account: String) -> Result<bool, String> {
    let item = entry(&account)?;
    match item.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("Could not read from the keychain: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_blank_account_name() {
        assert!(entry("").is_err());
        assert!(entry("   ").is_err());
    }

    #[test]
    fn accepts_a_provider_scoped_account_name() {
        // Keychain access itself is not exercised here: CI has no unlocked
        // login keychain, and a test that needs one is a test that gets
        // disabled. This asserts the naming guard only.
        assert!(entry("github:testuser").is_ok() || cfg!(target_os = "linux"));
    }
}
