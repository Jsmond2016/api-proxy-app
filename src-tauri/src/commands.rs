use std::collections::BTreeSet;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};

use crate::apifox::{
    apply_mock_token, build_rules, fetch_document, find_operation, parse_document, replace_rules,
};
use crate::model::{
    ApifoxConnection, ApifoxMode, ApifoxPreview, ApifoxRequest, DesktopSnapshot, InterfacePreview,
    MatchMode, OperationResolution, ProfileInput, ProjectProfile, ProxyRule, ProxyStatus,
    ResolveOperationInput, ResolvedInterface, RuleInput, RuleSource,
};
use crate::proxy;
use crate::state::AppState;

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    refresh_certificate_status(&state)?;
    snapshot(&state)
}

#[tauri::command]
pub fn create_profile(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let profile = build_profile(input)?;
    let mut current = lock_snapshot(&state)?;
    if current.profiles.iter().any(|item| item.id == profile.id) {
        return Err("profile ID already exists".to_string());
    }
    current.active_profile_id = Some(profile.id.clone());
    current.profiles.push(profile);
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn update_profile(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    ensure_proxy_stopped(&state)?;
    let id = input
        .id
        .clone()
        .ok_or_else(|| "profile ID is required".to_string())?;
    let validated = validate_profile_input(&input)?;
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "profile was not found".to_string())?;
    profile.name = validated.0;
    profile.source_hosts = validated.1;
    profile.path_prefix = validated.2;
    profile.port = input.port;
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn delete_profile(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    ensure_proxy_stopped(&state)?;
    let mut current = lock_snapshot(&state)?;
    let original_len = current.profiles.len();
    current.profiles.retain(|profile| profile.id != profile_id);
    if current.profiles.len() == original_len {
        return Err("profile was not found".to_string());
    }
    if current.active_profile_id.as_deref() == Some(profile_id.as_str()) {
        current.active_profile_id = current.profiles.first().map(|profile| profile.id.clone());
    }
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn set_active_profile(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    ensure_proxy_stopped(&state)?;
    let mut current = lock_snapshot(&state)?;
    if !current
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err("profile was not found".to_string());
    }
    current.active_profile_id = Some(profile_id);
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub async fn validate_apifox(
    mut request: ApifoxRequest,
    state: State<'_, AppState>,
) -> Result<ApifoxPreview, String> {
    ensure_profile_exists(&state, &request.profile_id)?;
    let stored = apifox_connection(&state, &request.profile_id)?;
    let access_token = resolve_token(request.access_token.as_deref(), &stored.access_token);
    let mock_token =
        resolve_token(request.mock_token.as_deref(), &stored.mock_token).unwrap_or_default();
    let content = fetch_document(&request, access_token.as_deref()).await?;
    let document = parse_document(&content)?;
    validate_selected_tags(&document.available_tags, &request.selected_tags)?;
    if request.selected_tags.is_empty() {
        request.selected_tags = document.available_tags.clone();
    }
    apply_default_mock_prefix(&mut request);
    let mut incoming = build_rules(
        &document.operations,
        &request.selected_tags,
        &request.mock_prefix,
        &request.project_id,
    )?;
    apply_mock_token(&mut incoming, &mock_token)?;
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == request.profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    let existing_ids = profile
        .rules
        .iter()
        .filter(|rule| rule.source == RuleSource::Apifox)
        .map(|rule| rule.source_operation_id.clone())
        .collect::<BTreeSet<_>>();
    let incoming_ids = incoming
        .iter()
        .map(|rule| rule.source_operation_id.clone())
        .collect::<BTreeSet<_>>();
    let interfaces = incoming
        .iter()
        .map(|rule| InterfacePreview {
            id: rule.source_operation_id.clone(),
            name: rule.name.clone(),
            method: rule.method.clone(),
            path: rule.path.clone(),
            tags: rule.tags.clone(),
        })
        .collect();
    let removed_count = existing_ids.difference(&incoming_ids).count();
    let retained_count = profile
        .rules
        .iter()
        .filter(|rule| rule.source != RuleSource::Apifox)
        .count();
    profile.apifox = build_apifox_connection(&request, access_token.as_deref(), &mock_token);
    state.persist(&current)?;
    drop(current);
    update_runtime_mock_token(&state, &request.profile_id, &mock_token)?;
    Ok(ApifoxPreview {
        available_tags: document.available_tags,
        operation_count: document.operations.len(),
        selected_operation_count: incoming.len(),
        added_count: incoming_ids.difference(&existing_ids).count(),
        updated_count: incoming_ids.intersection(&existing_ids).count(),
        removed_count,
        retained_count,
        interfaces,
    })
}

#[tauri::command]
pub async fn sync_apifox(
    mut request: ApifoxRequest,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    ensure_profile_exists(&state, &request.profile_id)?;
    let stored = apifox_connection(&state, &request.profile_id)?;
    let access_token = resolve_token(request.access_token.as_deref(), &stored.access_token);
    let mock_token =
        resolve_token(request.mock_token.as_deref(), &stored.mock_token).unwrap_or_default();
    let content = fetch_document(&request, access_token.as_deref()).await?;
    let document = parse_document(&content)?;
    validate_selected_tags(&document.available_tags, &request.selected_tags)?;
    if request.selected_tags.is_empty() {
        request.selected_tags = document.available_tags.clone();
    }
    apply_default_mock_prefix(&mut request);
    let mut incoming = build_rules(
        &document.operations,
        &request.selected_tags,
        &request.mock_prefix,
        &request.project_id,
    )?;
    apply_mock_token(&mut incoming, &mock_token)?;
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == request.profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    profile.rules = replace_rules(&profile.rules, incoming);
    apply_mock_token(&mut profile.rules, &mock_token)?;
    profile.synced_tags = request.selected_tags.clone();
    profile.active_tags = profile.synced_tags.clone();
    profile.apifox = build_apifox_connection(&request, access_token.as_deref(), &mock_token);
    state.persist(&current)?;
    let snapshot = current.clone();
    drop(current);
    update_runtime_mock_token(&state, &request.profile_id, &mock_token)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn resolve_apifox_operation(
    input: ResolveOperationInput,
    state: State<'_, AppState>,
) -> Result<OperationResolution, String> {
    let connection = apifox_connection(&state, &input.profile_id)?;
    let mut request = ApifoxRequest {
        profile_id: input.profile_id,
        mode: connection.mode,
        project_id: connection.project_id,
        local_openapi_url: connection.local_openapi_url,
        mock_prefix: connection.mock_prefix,
        access_token: Some(connection.access_token),
        mock_token: Some(connection.mock_token.clone()),
        selected_tags: Vec::new(),
    };
    apply_default_mock_prefix(&mut request);
    let content = fetch_document(&request, request.access_token.as_deref()).await?;
    let document = parse_document(&content)?;
    let matched = find_operation(&document.operations, &input.url, &input.method);
    let Some(operation) = matched.operation else {
        return Ok(OperationResolution {
            match_count: matched.match_count,
            interface: None,
        });
    };
    let mut rules = build_rules(&[operation], &[], &request.mock_prefix, &request.project_id)?;
    apply_mock_token(
        &mut rules,
        request.mock_token.as_deref().unwrap_or_default(),
    )?;
    let rule = rules
        .pop()
        .ok_or_else(|| "Matched interface could not be mapped".to_string())?;
    Ok(OperationResolution {
        match_count: 1,
        interface: Some(ResolvedInterface {
            name: rule.name,
            method: rule.method,
            path: rule.path,
            match_mode: rule.match_mode,
            target: rule.target,
            tags: rule.tags,
            apifox_web_url: rule.apifox_web_url,
        }),
    })
}

#[tauri::command]
pub fn save_rule(input: RuleInput, state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let mut rule = build_custom_rule(&input)?;
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == input.profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    if let Some(existing) = profile.rules.iter_mut().find(|item| item.id == rule.id) {
        rule.source = existing.source;
        rule.source_operation_id = existing.source_operation_id.clone();
        if rule.apifox_web_url.is_empty() {
            rule.apifox_web_url = existing.apifox_web_url.clone();
        }
        *existing = rule;
    } else {
        profile.rules.push(rule);
    }
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn delete_rule(
    profile_id: String,
    rule_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    let original_len = profile.rules.len();
    profile.rules.retain(|rule| rule.id != rule_id);
    if original_len == profile.rules.len() {
        return Err("rule was not found".to_string());
    }
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn clear_rules(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    reset_profile_rules(profile);
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn set_rule_enabled(
    profile_id: String,
    rule_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    let rule = profile
        .rules
        .iter_mut()
        .find(|rule| rule.id == rule_id)
        .ok_or_else(|| "rule was not found".to_string())?;
    rule.enabled = enabled;
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn set_global_mock_enabled(
    profile_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    profile.global_mock_enabled = enabled;
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn generate_certificate(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let material = state.certificate_material()?;
    let mut current = lock_snapshot(&state)?;
    current.certificate.generated = true;
    current.certificate.trusted = certificate_is_trusted(&material.certificate_path);
    current.certificate.fingerprint = material.fingerprint;
    current.certificate.certificate_path = material.certificate_path.to_string_lossy().to_string();
    Ok(current.clone())
}

#[tauri::command]
pub fn refresh_certificate(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    refresh_certificate_status(&state)?;
    snapshot(&state)
}

#[tauri::command]
pub fn open_certificate(state: State<'_, AppState>) -> Result<(), String> {
    let material = state.certificate_material()?;
    Command::new("open")
        .arg(material.certificate_path)
        .spawn()
        .map_err(|error| format!("failed to open certificate: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    current.logs.clear();
    Ok(current.clone())
}

#[tauri::command]
pub async fn start_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    proxy::start_proxy(&app, &state).await
}

#[tauri::command]
pub fn stop_proxy(app: AppHandle, state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    proxy::stop_proxy(&app, &state)
}

fn build_profile(input: ProfileInput) -> Result<ProjectProfile, String> {
    let (name, source_hosts, path_prefix) = validate_profile_input(&input)?;
    Ok(ProjectProfile {
        id: input.id.unwrap_or_else(|| create_id("profile")),
        name,
        source_hosts,
        path_prefix,
        port: input.port,
        apifox: ApifoxConnection::default(),
        synced_tags: Vec::new(),
        active_tags: Vec::new(),
        global_mock_enabled: false,
        rules: Vec::new(),
    })
}

fn reset_profile_rules(profile: &mut ProjectProfile) {
    profile.rules.clear();
    profile.synced_tags.clear();
    profile.active_tags.clear();
}

fn validate_profile_input(input: &ProfileInput) -> Result<(String, Vec<String>, String), String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    if input.port == 0 {
        return Err("Proxy port must be between 1 and 65535".to_string());
    }
    let mut hosts = Vec::new();
    for value in &input.source_hosts {
        let host = normalize_host(value)?;
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    if hosts.is_empty() {
        return Err("At least one source host is required".to_string());
    }
    let path_prefix = input.path_prefix.trim().trim_end_matches('/').to_string();
    if !path_prefix.is_empty() && !path_prefix.starts_with('/') {
        return Err("Path prefix must start with /".to_string());
    }
    Ok((name, hosts, path_prefix))
}

fn normalize_host(value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("Source host cannot be empty".to_string());
    }
    let candidate = if trimmed.contains("://") {
        trimmed
    } else {
        format!("https://{trimmed}")
    };
    let parsed =
        url::Url::parse(&candidate).map_err(|error| format!("Source host is invalid: {error}"))?;
    parsed
        .host_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Source host is invalid".to_string())
}

fn build_custom_rule(input: &RuleInput) -> Result<ProxyRule, String> {
    let name = input.name.trim();
    let method = input.method.trim().to_uppercase();
    let path = input.path.trim();
    if name.is_empty() || method.is_empty() || path.is_empty() {
        return Err("Mock interface name, method and URL are required".to_string());
    }
    if !path.starts_with('/') && input.match_mode != MatchMode::Regex {
        return Err("Mock interface URL must start with /".to_string());
    }
    url::Url::parse(input.target.trim())
        .map_err(|error| format!("Mock URL is invalid: {error}"))?;
    Ok(ProxyRule {
        id: input.id.clone().unwrap_or_else(|| create_id("rule")),
        source: RuleSource::Custom,
        source_operation_id: String::new(),
        apifox_web_url: input.apifox_web_url.trim().to_string(),
        name: name.to_string(),
        method,
        path: path.to_string(),
        match_mode: input.match_mode,
        target: input.target.trim().to_string(),
        enabled: input.enabled,
        tags: unique_non_empty(input.tags.clone()),
        priority: input.priority,
    })
}

fn resolve_token(provided: Option<&str>, stored: &str) -> Option<String> {
    if let Some(value) = provided {
        if !value.trim().is_empty() {
            return Some(value.trim().to_string());
        }
    }
    if stored.trim().is_empty() {
        return None;
    }
    Some(stored.trim().to_string())
}

fn apifox_connection(state: &AppState, profile_id: &str) -> Result<ApifoxConnection, String> {
    let current = lock_snapshot(state)?;
    current
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .map(|profile| profile.apifox.clone())
        .ok_or_else(|| "profile was not found".to_string())
}

fn build_apifox_connection(
    request: &ApifoxRequest,
    access_token: Option<&str>,
    mock_token: &str,
) -> ApifoxConnection {
    ApifoxConnection {
        mode: request.mode,
        project_id: request.project_id.trim().to_string(),
        local_openapi_url: request.local_openapi_url.trim().to_string(),
        mock_prefix: request.mock_prefix.trim().to_string(),
        access_token: access_token.unwrap_or_default().to_string(),
        mock_token: mock_token.to_string(),
    }
}

fn update_runtime_mock_token(
    state: &AppState,
    profile_id: &str,
    mock_token: &str,
) -> Result<(), String> {
    if mock_token.is_empty() {
        return Ok(());
    }
    state.update_runtime_mock_token(profile_id, mock_token)?;
    Ok(())
}

fn apply_default_mock_prefix(request: &mut ApifoxRequest) {
    if request.mock_prefix.trim().is_empty() && matches!(request.mode, ApifoxMode::Online) {
        request.mock_prefix = format!(
            "https://m1.apifoxmock.com/m1/{}-0-default",
            request.project_id.trim()
        );
    }
}

fn refresh_certificate_status(state: &AppState) -> Result<(), String> {
    let path = state.certificate_path();
    let mut current = lock_snapshot(state)?;
    current.certificate.generated = path.exists();
    current.certificate.trusted = path.exists() && certificate_is_trusted(&path);
    current.certificate.certificate_path = if path.exists() {
        path.to_string_lossy().to_string()
    } else {
        String::new()
    };
    Ok(())
}

fn certificate_is_trusted(path: &std::path::Path) -> bool {
    Command::new("security")
        .arg("verify-cert")
        .arg("-c")
        .arg(path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn validate_selected_tags(available: &[String], selected: &[String]) -> Result<(), String> {
    let available = available.iter().collect::<BTreeSet<_>>();
    for tag in selected {
        if !available.contains(tag) {
            return Err(format!("Selected tag does not exist in OpenAPI: {tag}"));
        }
    }
    Ok(())
}

fn unique_non_empty(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn ensure_profile_exists(state: &AppState, profile_id: &str) -> Result<(), String> {
    let current = lock_snapshot(state)?;
    if current
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Ok(());
    }
    Err("profile was not found".to_string())
}

fn ensure_proxy_stopped(state: &AppState) -> Result<(), String> {
    let current = lock_snapshot(state)?;
    if current.proxy_status == ProxyStatus::Stopped || current.proxy_status == ProxyStatus::Error {
        return Ok(());
    }
    Err("Stop the proxy before changing the active project or listener".to_string())
}

fn lock_snapshot(state: &AppState) -> Result<std::sync::MutexGuard<'_, DesktopSnapshot>, String> {
    state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())
}

fn snapshot(state: &AppState) -> Result<DesktopSnapshot, String> {
    Ok(lock_snapshot(state)?.clone())
}

fn create_id(prefix: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{timestamp}")
}

#[cfg(test)]
mod tests {
    use super::{
        build_custom_rule, build_profile, normalize_host, reset_profile_rules, resolve_token,
    };
    use crate::model::{MatchMode, ProfileInput, ProxyRule, RuleInput, RuleSource};

    #[test]
    fn normalizes_source_hosts() {
        assert_eq!(
            normalize_host("HTTPS://API.EXAMPLE.COM/v1").expect("host should parse"),
            "api.example.com"
        );
        assert_eq!(
            normalize_host("api.example.com:8443").expect("host should parse"),
            "api.example.com"
        );
    }

    #[test]
    fn creates_profiles_with_global_mock_disabled() {
        let profile = build_profile(ProfileInput {
            id: None,
            name: "Profile".to_string(),
            source_hosts: vec!["api.example.test".to_string()],
            path_prefix: String::new(),
            port: 8899,
        })
        .expect("profile should build");

        assert!(!profile.global_mock_enabled);
    }

    #[test]
    fn provided_token_overrides_stored_value_and_blank_reuses_it() {
        assert_eq!(
            resolve_token(Some(" new-token "), "stored-token").as_deref(),
            Some("new-token")
        );
        assert_eq!(
            resolve_token(None, "stored-token").as_deref(),
            Some("stored-token")
        );
        assert_eq!(
            resolve_token(Some("   "), "stored-token").as_deref(),
            Some("stored-token")
        );
    }

    #[test]
    fn mapped_custom_interface_preserves_apifox_web_url() {
        let rule = build_custom_rule(&RuleInput {
            id: None,
            profile_id: "profile".to_string(),
            name: "订单详情".to_string(),
            method: "GET".to_string(),
            path: "/orders/{id}".to_string(),
            match_mode: MatchMode::Template,
            target: "https://mock.example.test/orders/{id}".to_string(),
            enabled: true,
            tags: vec!["订单".to_string()],
            priority: 100,
            apifox_web_url: "https://app.apifox.com/project/123/apis/api-456".to_string(),
        })
        .expect("mapped interface should build");

        assert_eq!(
            rule.apifox_web_url,
            "https://app.apifox.com/project/123/apis/api-456"
        );
        assert_eq!(rule.source, RuleSource::Custom);
    }

    #[test]
    fn reset_clears_rules_and_tags_but_preserves_project_configuration() {
        let mut profile = build_profile(ProfileInput {
            id: Some("profile".to_string()),
            name: "Profile".to_string(),
            source_hosts: vec!["api.example.test".to_string()],
            path_prefix: String::new(),
            port: 8899,
        })
        .expect("profile should build");
        profile.apifox.project_id = "123".to_string();
        profile.apifox.access_token = "access-token".to_string();
        profile.apifox.mock_token = "mock-token".to_string();
        profile.apifox.mock_prefix = "https://mock.example.test".to_string();
        profile.synced_tags = vec!["订单".to_string()];
        profile.active_tags = vec!["订单".to_string()];
        profile.global_mock_enabled = true;
        profile.rules.push(ProxyRule {
            id: "rule".to_string(),
            source: RuleSource::Apifox,
            source_operation_id: "source".to_string(),
            apifox_web_url: String::new(),
            name: "Rule".to_string(),
            method: "GET".to_string(),
            path: "/orders".to_string(),
            match_mode: MatchMode::Exact,
            target: "https://mock.example.test/orders".to_string(),
            enabled: true,
            tags: vec!["订单".to_string()],
            priority: 100,
        });

        reset_profile_rules(&mut profile);

        assert!(profile.rules.is_empty());
        assert!(profile.synced_tags.is_empty());
        assert!(profile.active_tags.is_empty());
        assert_eq!(profile.apifox.project_id, "123");
        assert_eq!(profile.apifox.access_token, "access-token");
        assert_eq!(profile.apifox.mock_token, "mock-token");
        assert_eq!(profile.apifox.mock_prefix, "https://mock.example.test");
        assert!(profile.global_mock_enabled);
    }
}
