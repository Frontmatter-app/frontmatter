//! The OAuth device flow's HTTP calls, made natively.
//!
//! These cannot be made from the webview. `github.com/login/device/code` and
//! `/login/oauth/access_token` send no `Access-Control-Allow-Origin`, so a
//! browser or webview `fetch` is blocked before the request is even sent —
//! which is exactly what happened, and no amount of client-side handling can
//! fix it. The provider's API host (`api.github.com`) *does* send CORS headers,
//! which is why the rest of the adapter works from TypeScript and only these
//! two endpoints need to move.
//!
//! Doing it here has a second benefit worth keeping even if CORS were not a
//! problem: the access token is returned once and written straight to the
//! keychain, so it need never sit in webview memory at all.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeGrant {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Seconds until expiry, or None when the token does not expire.
    pub expires_in: Option<u64>,
}

/// A provider response is either a grant, a token, or an error code.
#[derive(Deserialize, Default)]
struct RawResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn post_form(url: &str, form: HashMap<&str, &str>) -> Result<RawResponse, String> {
    let response = reqwest::Client::new()
        .post(url)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Could not reach the provider: {error}"))?;

    response
        .json::<RawResponse>()
        .await
        .map_err(|error| format!("The provider sent an unreadable response: {error}"))
}

/// Step one: ask the provider for a code to show the user.
#[tauri::command]
pub async fn forge_device_code(
    device_code_url: String,
    client_id: String,
    scope: String,
) -> Result<DeviceCodeGrant, String> {
    let mut form = HashMap::new();
    form.insert("client_id", client_id.as_str());
    form.insert("scope", scope.as_str());

    let raw = post_form(&device_code_url, form).await?;

    if let Some(error) = raw.error {
        return Err(raw.error_description.unwrap_or(error));
    }

    Ok(DeviceCodeGrant {
        user_code: raw.user_code.ok_or("The provider returned no user code.")?,
        verification_uri: raw
            .verification_uri
            .ok_or("The provider returned no verification URL.")?,
        device_code: raw.device_code.ok_or("The provider returned no device code.")?,
        expires_in: raw.expires_in.unwrap_or(900),
        // Polling faster than the provider allows earns a `slow_down`, so an
        // absent interval must not become zero.
        interval: raw.interval.unwrap_or(5),
    })
}

/// Step two, one attempt.
///
/// Returns `Ok(None)` while the user has not finished, so the caller owns the
/// polling loop, the interval, and cancellation. `authorization_pending` and
/// `slow_down` are the normal states for most of that loop, not failures.
#[tauri::command]
pub async fn forge_device_poll(
    token_url: String,
    client_id: String,
    device_code: String,
) -> Result<Option<TokenSet>, String> {
    let mut form = HashMap::new();
    form.insert("client_id", client_id.as_str());
    form.insert("device_code", device_code.as_str());
    form.insert(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:device_code",
    );

    let raw = post_form(&token_url, form).await?;

    if let Some(access_token) = raw.access_token {
        return Ok(Some(TokenSet {
            access_token,
            refresh_token: raw.refresh_token,
            expires_in: raw.expires_in,
        }));
    }

    match raw.error.as_deref() {
        Some("authorization_pending") | Some("slow_down") => Ok(None),
        Some(other) => Err(raw.error_description.unwrap_or_else(|| other.to_string())),
        None => Err("The provider sent neither a token nor an error.".into()),
    }
}

/// Exchanges a refresh token for a fresh access token.
///
/// GitHub rotates the refresh token on every use, so the returned one must be
/// stored: reusing a spent refresh token is treated as theft and revokes the
/// whole grant.
#[tauri::command]
pub async fn forge_refresh_token(
    token_url: String,
    client_id: String,
    refresh_token: String,
) -> Result<TokenSet, String> {
    let mut form = HashMap::new();
    form.insert("client_id", client_id.as_str());
    form.insert("grant_type", "refresh_token");
    form.insert("refresh_token", refresh_token.as_str());

    let raw = post_form(&token_url, form).await?;

    match raw.access_token {
        Some(access_token) => Ok(TokenSet {
            access_token,
            refresh_token: raw.refresh_token,
            expires_in: raw.expires_in,
        }),
        None => Err(raw
            .error_description
            .or(raw.error)
            .unwrap_or_else(|| "The connection expired. Connect the account again.".into())),
    }
}
