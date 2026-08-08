use tauri::State;

use crate::apifox::{build_rules, parse_operations};
use crate::model::{DesktopSnapshot, OpenApiSyncRequest, ProxyStatus};
use crate::proxy;
use crate::state::AppState;

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    Ok(snapshot.clone())
}

#[tauri::command]
pub fn set_proxy_status(
    status: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    snapshot.proxy_status = parse_proxy_status(&status)?;
    state.persist(&snapshot)?;
    Ok(snapshot.clone())
}

#[tauri::command]
pub fn set_active_profile(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    let profile_exists = snapshot
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id);

    if !profile_exists {
        return Err("profile was not found".to_string());
    }

    snapshot.active_profile_id = profile_id;
    state.persist(&snapshot)?;
    Ok(snapshot.clone())
}

#[tauri::command]
pub fn set_rule_enabled(
    rule_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    let mut updated = false;

    for profile in &mut snapshot.profiles {
        for rule in &mut profile.rules {
            if rule.id == rule_id {
                rule.enabled = enabled;
                updated = true;
            }
        }
    }

    if !updated {
        return Err("rule was not found".to_string());
    }

    state.persist(&snapshot)?;
    Ok(snapshot.clone())
}

#[tauri::command]
pub fn generate_certificate(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let material = state.certificate_material()?;
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    snapshot.certificate.generated = true;
    snapshot.certificate.trusted = false;
    snapshot.certificate.fingerprint = material.fingerprint;
    state.persist(&snapshot)?;
    Ok(snapshot.clone())
}

#[tauri::command]
pub fn start_proxy(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    proxy::start_proxy(&state)
}

#[tauri::command]
pub fn stop_proxy(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    proxy::stop_proxy(&state)
}

#[tauri::command]
pub async fn sync_openapi(
    request: OpenApiSyncRequest,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let client = reqwest::Client::new();
    let mut request_builder = client.get(&request.source_url);

    if let Some(token) = request.access_token.as_deref() {
        request_builder = request_builder.bearer_auth(token);
    }

    let response = request_builder
        .send()
        .await
        .map_err(|error| format!("Unable to fetch OpenAPI document: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("OpenAPI endpoint returned HTTP {status}"));
    }

    let content = response
        .text()
        .await
        .map_err(|error| format!("Unable to read OpenAPI response: {error}"))?;
    let operations = parse_operations(&content, &request.selected_tags)?;
    let rules = build_rules(operations, &request.mock_prefix);
    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    let profile = snapshot
        .profiles
        .iter_mut()
        .find(|profile| profile.id == request.profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;

    profile.apifox.mode = request.mode;
    profile.apifox.source = request.source_url;
    profile.apifox.mock_prefix = request.mock_prefix;
    profile.apifox.selected_tags = request.selected_tags;
    profile.rules = rules;
    state.persist(&snapshot)?;

    Ok(snapshot.clone())
}

fn parse_proxy_status(status: &str) -> Result<ProxyStatus, String> {
    match status {
        "stopped" => Ok(ProxyStatus::Stopped),
        "starting" => Ok(ProxyStatus::Starting),
        "running" => Ok(ProxyStatus::Running),
        "error" => Ok(ProxyStatus::Error),
        _ => Err("unsupported proxy status".to_string()),
    }
}
