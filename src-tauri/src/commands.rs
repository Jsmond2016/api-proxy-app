use std::collections::BTreeSet;
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use reqwest::Method;

use tauri::{AppHandle, State};

use crate::apifox::{
    apply_mock_token, build_rules, fetch_document, find_operation, parse_document, replace_rules,
};
use crate::model::{
    ApifoxConnection, ApifoxMode, ApifoxPreview, ApifoxRequest, DesktopSnapshot, InterfacePreview,
    LocalMockResponse, LocalMockResponseInput, MatchMode, MockResponsePreview, OperationResolution,
    ProfileInput, ProjectProfile, ProxyRule, RequestLog, ResolveOperationInput, ResolvedInterface,
    RuleInput, RuleSource,
};
use crate::proxy;
use crate::state::AppState;

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    refresh_certificate_status(&state)?;
    snapshot(&state)
}

#[tauri::command]
pub async fn create_profile(
    app: AppHandle,
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut profile = build_profile(input)?;
    {
        let mut current = lock_snapshot(&state)?;
        if current.profiles.iter().any(|item| item.id == profile.id) {
            return Err("profile ID already exists".to_string());
        }
        inherit_apifox_from_first_profile(&mut profile, &current.profiles);
        current.active_profile_id = Some(profile.id.clone());
        current.profiles.push(profile);
        state.persist(&current)?;
    }
    proxy::ensure_proxy_running(&app, &state).await
}

#[tauri::command]
pub async fn update_profile(
    app: AppHandle,
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let id = input
        .id
        .clone()
        .ok_or_else(|| "profile ID is required".to_string())?;
    let validated = validate_profile_input(&input)?;
    let (is_active, snapshot) = {
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
        let is_active = current.active_profile_id.as_deref() == Some(id.as_str());
        state.persist(&current)?;
        (is_active, current.clone())
    };
    if is_active {
        return proxy::ensure_proxy_running(&app, &state).await;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let has_active_profile = {
        let mut current = lock_snapshot(&state)?;
        if current.profiles.len() <= 1 {
            return Err("至少保留一个联调项目".to_string());
        }
        let original_len = current.profiles.len();
        current.profiles.retain(|profile| profile.id != profile_id);
        if current.profiles.len() == original_len {
            return Err("profile was not found".to_string());
        }
        if current.active_profile_id.as_deref() == Some(profile_id.as_str()) {
            current.active_profile_id = current.profiles.first().map(|profile| profile.id.clone());
        }
        state.persist(&current)?;
        current.active_profile_id.is_some()
    };
    if has_active_profile {
        return proxy::ensure_proxy_running(&app, &state).await;
    }
    proxy::stop_proxy(&app, &state)
}

#[tauri::command]
pub async fn set_active_profile(
    app: AppHandle,
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    {
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
    }
    proxy::ensure_proxy_running(&app, &state).await
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
    scope_apifox_rules_to_profile(&mut incoming, &request.profile_id);
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
    scope_apifox_rules_to_profile(&mut incoming, &request.profile_id);
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
        if rule.local_response_id.is_some()
            && !profile
                .local_responses
                .iter()
                .any(|item| Some(&item.id) == rule.local_response_id.as_ref())
        {
            return Err("本地预设响应不存在".to_string());
        }
        *existing = rule;
    } else {
        if rule.local_response_id.is_some()
            && !profile
                .local_responses
                .iter()
                .any(|item| Some(&item.id) == rule.local_response_id.as_ref())
        {
            return Err("本地预设响应不存在".to_string());
        }
        profile.rules.push(rule);
    }
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn save_local_response(
    input: LocalMockResponseInput,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("响应名字不能为空".to_string());
    }
    if input.status == 0 || input.status > 599 {
        return Err("HTTP 状态必须在 100-599 之间".to_string());
    }
    let response = LocalMockResponse {
        id: input.id.unwrap_or_else(|| create_id("response")),
        name: name.to_string(),
        delay_ms: input.delay_ms.min(60000),
        status: input.status,
        body: input.body,
    };
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == input.profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    if let Some(existing) = profile
        .local_responses
        .iter_mut()
        .find(|item| item.id == response.id)
    {
        *existing = response;
    } else {
        profile.local_responses.push(response);
    }
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn delete_local_response(
    profile_id: String,
    response_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    profile
        .local_responses
        .retain(|item| item.id != response_id);
    for rule in &mut profile.rules {
        if rule.local_response_id.as_deref() == Some(response_id.as_str()) {
            rule.local_response_id = None;
        }
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
pub fn delete_rules(
    profile_id: String,
    rule_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let requested_ids = rule_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect::<BTreeSet<_>>();
    if requested_ids.is_empty() {
        return Err("请选择需要删除的 Mock 接口".to_string());
    }
    let mut current = lock_snapshot(&state)?;
    let profile = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "profile was not found".to_string())?;
    delete_rules_from_profile(profile, &requested_ids)?;
    state.persist(&current)?;
    Ok(current.clone())
}

#[tauri::command]
pub fn move_rules(
    source_profile_id: String,
    target_profile_id: String,
    rule_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    let mut current = lock_snapshot(&state)?;
    move_rules_between_profiles(
        &mut current,
        &source_profile_id,
        &target_profile_id,
        &rule_ids,
    )?;
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
pub async fn set_global_mock_enabled(
    app: AppHandle,
    profile_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<DesktopSnapshot, String> {
    {
        let mut current = lock_snapshot(&state)?;
        let profile = current
            .profiles
            .iter_mut()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| "profile was not found".to_string())?;
        profile.global_mock_enabled = enabled;
        state.persist(&current)?;
    }
    proxy::restart_proxy(&app, &state).await
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
pub async fn preview_mock_response(
    log_id: String,
    state: State<'_, AppState>,
) -> Result<MockResponsePreview, String> {
    let (log, profile, rule) = {
        let current = lock_snapshot(&state)?;
        preview_context(&current, &log_id)?
    };
    if let Some(response) = rule
        .local_response_id
        .as_ref()
        .and_then(|id| profile.local_responses.iter().find(|item| &item.id == id))
    {
        let started_at = Instant::now();
        if response.delay_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(response.delay_ms)).await;
        }
        return Ok(MockResponsePreview {
            source: "local".to_string(),
            request_url: "local://response".to_string(),
            status: response.status,
            status_text: format!("HTTP {}", response.status),
            duration: elapsed_millis(started_at),
            content_type: "application/json; charset=utf-8".to_string(),
            body: response.body.clone(),
            truncated: false,
        });
    }

    let target = proxy::rewrite_target_url(&log.source, &rule, Some(&profile.apifox.mock_token))?;
    let method = Method::from_bytes(log.method.as_bytes())
        .map_err(|_| "Mock 请求方式无效，无法重新请求".to_string())?;
    let started_at = Instant::now();
    let response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("无法创建 Mock 请求：{error}"))?
        .request(method, &target)
        .send()
        .await
        .map_err(|error| format!("Mock 请求失败：{error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 Mock 响应：{error}"))?;
    let (body, truncated) = truncate_preview_body(body);
    Ok(MockResponsePreview {
        source: "remote".to_string(),
        request_url: proxy::sanitize_url(&target),
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("Unknown").to_string(),
        duration: elapsed_millis(started_at),
        content_type,
        body,
        truncated,
    })
}

fn preview_context(
    snapshot: &DesktopSnapshot,
    log_id: &str,
) -> Result<(RequestLog, ProjectProfile, ProxyRule), String> {
    let log = snapshot
        .logs
        .iter()
        .find(|item| item.id == log_id)
        .cloned()
        .ok_or_else(|| "请求记录已不存在".to_string())?;
    if log.status != "matched" {
        return Err("仅已 Mock 的请求可以查看响应".to_string());
    }
    let profile = snapshot
        .profiles
        .iter()
        .find(|profile| profile.rules.iter().any(|rule| rule.id == log.rule_id))
        .cloned()
        .ok_or_else(|| "对应 Mock 接口已不存在".to_string())?;
    let rule = profile
        .rules
        .iter()
        .find(|rule| rule.id == log.rule_id)
        .cloned()
        .ok_or_else(|| "对应 Mock 接口已不存在".to_string())?;
    Ok((log, profile, rule))
}

fn truncate_preview_body(body: String) -> (String, bool) {
    const MAX_PREVIEW_BODY_BYTES: usize = 512 * 1024;
    if body.len() <= MAX_PREVIEW_BODY_BYTES {
        return (body, false);
    }
    let mut end = MAX_PREVIEW_BODY_BYTES;
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    (body[..end].to_string(), true)
}

fn elapsed_millis(started_at: Instant) -> u64 {
    u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX)
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
        local_responses: Vec::new(),
    })
}

fn inherit_apifox_from_first_profile(
    profile: &mut ProjectProfile,
    existing_profiles: &[ProjectProfile],
) {
    if let Some(first) = existing_profiles.first() {
        profile.apifox = first.apifox.clone();
    }
}

fn reset_profile_rules(profile: &mut ProjectProfile) {
    profile.rules.clear();
    profile.synced_tags.clear();
    profile.active_tags.clear();
}

fn delete_rules_from_profile(
    profile: &mut ProjectProfile,
    requested_ids: &BTreeSet<&str>,
) -> Result<usize, String> {
    let existing_ids = profile
        .rules
        .iter()
        .map(|rule| rule.id.as_str())
        .collect::<BTreeSet<_>>();
    if requested_ids.iter().any(|id| !existing_ids.contains(id)) {
        return Err("部分 Mock 接口不存在".to_string());
    }
    profile
        .rules
        .retain(|rule| !requested_ids.contains(rule.id.as_str()));
    Ok(requested_ids.len())
}

fn scope_apifox_rules_to_profile(rules: &mut [ProxyRule], profile_id: &str) {
    for rule in rules
        .iter_mut()
        .filter(|rule| rule.source == RuleSource::Apifox)
    {
        rule.id = format!("apifox-{profile_id}-{}", rule.source_operation_id);
    }
}

fn rules_conflict(left: &ProxyRule, right: &ProxyRule) -> bool {
    left.id == right.id
        || (left.source == RuleSource::Apifox
            && right.source == RuleSource::Apifox
            && !left.source_operation_id.is_empty()
            && left.source_operation_id == right.source_operation_id)
}

fn move_rules_between_profiles(
    snapshot: &mut DesktopSnapshot,
    source_profile_id: &str,
    target_profile_id: &str,
    rule_ids: &[String],
) -> Result<usize, String> {
    if source_profile_id == target_profile_id {
        return Err("请选择其他 Tab".to_string());
    }
    let requested_ids = rule_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect::<BTreeSet<_>>();
    if requested_ids.is_empty() {
        return Err("请选择需要移动的 Mock 接口".to_string());
    }
    let source_index = snapshot
        .profiles
        .iter()
        .position(|profile| profile.id == source_profile_id)
        .ok_or_else(|| "源 Tab 不存在".to_string())?;
    let target_index = snapshot
        .profiles
        .iter()
        .position(|profile| profile.id == target_profile_id)
        .ok_or_else(|| "目标 Tab 不存在".to_string())?;
    let moved_rules = snapshot.profiles[source_index]
        .rules
        .iter()
        .filter(|rule| requested_ids.contains(rule.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if moved_rules.len() != requested_ids.len() {
        return Err("部分 Mock 接口不存在".to_string());
    }
    if moved_rules.iter().any(|rule| {
        snapshot.profiles[target_index]
            .rules
            .iter()
            .any(|target_rule| rules_conflict(target_rule, rule))
    }) {
        return Err("目标 Tab 已存在相同 Mock 接口".to_string());
    }
    let response_ids = moved_rules
        .iter()
        .filter_map(|rule| rule.local_response_id.as_deref())
        .collect::<BTreeSet<_>>();
    let moved_responses = snapshot.profiles[source_index]
        .local_responses
        .iter()
        .filter(|response| response_ids.contains(response.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if moved_responses.len() != response_ids.len() {
        return Err("Mock 接口引用的本地预设响应不存在".to_string());
    }

    snapshot.profiles[source_index]
        .rules
        .retain(|rule| !requested_ids.contains(rule.id.as_str()));
    let target = &mut snapshot.profiles[target_index];
    for response in moved_responses {
        if !target
            .local_responses
            .iter()
            .any(|item| item.id == response.id)
        {
            target.local_responses.push(response);
        }
    }
    let moved_count = moved_rules.len();
    target.rules.extend(moved_rules);
    Ok(moved_count)
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
    if input.local_response_id.is_none() {
        url::Url::parse(input.target.trim())
            .map_err(|error| format!("Mock URL is invalid: {error}"))?;
    }
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
        local_response_id: input.local_response_id.clone(),
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
    use std::collections::BTreeSet;

    use super::{
        build_custom_rule, build_profile, delete_rules_from_profile,
        inherit_apifox_from_first_profile, move_rules_between_profiles, normalize_host,
        preview_context, reset_profile_rules, resolve_token, scope_apifox_rules_to_profile,
    };
    use crate::model::{
        DesktopSnapshot, LocalMockResponse, MatchMode, ProfileInput, ProjectProfile, ProxyRule,
        RequestLog, RuleInput, RuleSource,
    };

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
    fn new_profile_inherits_first_profile_apifox_connection_without_tags() {
        let mut first = test_profile("first");
        first.apifox.project_id = "123456".to_string();
        first.apifox.mock_prefix = "https://mock.example.test".to_string();
        first.apifox.access_token = "access-token".to_string();
        first.apifox.mock_token = "mock-token".to_string();
        first.synced_tags = vec!["订单".to_string()];
        first.active_tags = vec!["订单".to_string()];
        let mut created = test_profile("created");

        inherit_apifox_from_first_profile(&mut created, &[first]);

        assert_eq!(created.apifox.project_id, "123456");
        assert_eq!(created.apifox.mock_prefix, "https://mock.example.test");
        assert_eq!(created.apifox.access_token, "access-token");
        assert_eq!(created.apifox.mock_token, "mock-token");
        assert!(created.synced_tags.is_empty());
        assert!(created.active_tags.is_empty());
    }

    #[test]
    fn apifox_rule_ids_are_stable_within_a_profile_and_isolated_between_profiles() {
        let mut first_sync = vec![test_apifox_rule("apifox-list-orders", "list-orders")];
        let mut repeated_sync = first_sync.clone();
        let mut other_profile_sync = first_sync.clone();

        scope_apifox_rules_to_profile(&mut first_sync, "profile-a");
        scope_apifox_rules_to_profile(&mut repeated_sync, "profile-a");
        scope_apifox_rules_to_profile(&mut other_profile_sync, "profile-b");

        assert_eq!(first_sync[0].id, repeated_sync[0].id);
        assert_ne!(first_sync[0].id, other_profile_sync[0].id);
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
            local_response_id: None,
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
            local_response_id: None,
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

    #[test]
    fn move_rules_moves_all_selected_rules_and_copies_local_response_dependencies() {
        let mut source = test_profile("source");
        source.local_responses.push(LocalMockResponse {
            id: "response".to_string(),
            name: "Success".to_string(),
            delay_ms: 0,
            status: 200,
            body: "{}".to_string(),
        });
        source.rules.push(test_rule("first", Some("response")));
        source.rules.push(test_rule("second", None));
        let target = test_profile("target");
        let mut snapshot = DesktopSnapshot {
            profiles: vec![source, target],
            ..DesktopSnapshot::default()
        };

        let moved = move_rules_between_profiles(
            &mut snapshot,
            "source",
            "target",
            &[
                "second".to_string(),
                "first".to_string(),
                "first".to_string(),
            ],
        )
        .expect("rules should move");

        assert_eq!(moved, 2);
        assert!(snapshot.profiles[0].rules.is_empty());
        assert_eq!(snapshot.profiles[1].rules.len(), 2);
        assert_eq!(snapshot.profiles[1].rules[0].id, "first");
        assert_eq!(snapshot.profiles[1].rules[1].id, "second");
        assert_eq!(snapshot.profiles[1].local_responses.len(), 1);
        assert_eq!(snapshot.profiles[1].local_responses[0].id, "response");
    }

    #[test]
    fn move_rules_rejects_target_id_conflicts_without_changing_profiles() {
        let mut source = test_profile("source");
        source.rules.push(test_rule("duplicate", None));
        let mut target = test_profile("target");
        target.rules.push(test_rule("duplicate", None));
        let mut snapshot = DesktopSnapshot {
            profiles: vec![source, target],
            ..DesktopSnapshot::default()
        };

        let result = move_rules_between_profiles(
            &mut snapshot,
            "source",
            "target",
            &["duplicate".to_string()],
        );

        assert_eq!(result, Err("目标 Tab 已存在相同 Mock 接口".to_string()));
        assert_eq!(snapshot.profiles[0].rules.len(), 1);
        assert_eq!(snapshot.profiles[1].rules.len(), 1);
    }

    #[test]
    fn move_rules_rejects_same_apifox_operation_with_profile_scoped_ids() {
        let mut source = test_profile("source");
        source
            .rules
            .push(test_apifox_rule("apifox-source-operation", "operation"));
        let mut target = test_profile("target");
        target
            .rules
            .push(test_apifox_rule("apifox-target-operation", "operation"));
        let mut snapshot = DesktopSnapshot {
            profiles: vec![source, target],
            ..DesktopSnapshot::default()
        };

        let result = move_rules_between_profiles(
            &mut snapshot,
            "source",
            "target",
            &["apifox-source-operation".to_string()],
        );

        assert_eq!(result, Err("目标 Tab 已存在相同 Mock 接口".to_string()));
        assert_eq!(snapshot.profiles[0].rules.len(), 1);
        assert_eq!(snapshot.profiles[1].rules.len(), 1);
    }

    #[test]
    fn delete_rules_is_atomic_when_any_selected_rule_is_missing() {
        let mut profile = test_profile("profile");
        profile.rules.push(test_rule("first", None));
        profile.rules.push(test_rule("second", None));
        let requested = ["first", "missing"].into_iter().collect::<BTreeSet<_>>();

        let result = delete_rules_from_profile(&mut profile, &requested);

        assert_eq!(result, Err("部分 Mock 接口不存在".to_string()));
        assert_eq!(profile.rules.len(), 2);
    }

    #[test]
    fn preview_context_only_allows_matched_requests_with_a_current_rule() {
        let mut profile = test_profile("profile");
        profile.rules.push(test_rule("order", None));
        let mut snapshot = DesktopSnapshot {
            profiles: vec![profile],
            ..DesktopSnapshot::default()
        };
        snapshot.logs.push(RequestLog {
            id: "matched".to_string(),
            created_at: "0".to_string(),
            method: "GET".to_string(),
            source: "https://api.example.test/order".to_string(),
            destination: "https://mock.example.test/order".to_string(),
            rule_id: "order".to_string(),
            rule_name: "order".to_string(),
            tag: String::new(),
            status: "matched".to_string(),
            stage: "rule".to_string(),
            response_code: Some(200),
            duration: 1,
        });
        snapshot.logs.push(RequestLog {
            id: "passed".to_string(),
            status: "passed".to_string(),
            ..snapshot.logs[0].clone()
        });

        let (_, profile, rule) =
            preview_context(&snapshot, "matched").expect("matched log should resolve");

        assert_eq!(profile.id, "profile");
        assert_eq!(rule.id, "order");
        assert!(matches!(
            preview_context(&snapshot, "passed"),
            Err(message) if message == "仅已 Mock 的请求可以查看响应"
        ));
    }

    fn test_profile(id: &str) -> ProjectProfile {
        build_profile(ProfileInput {
            id: Some(id.to_string()),
            name: id.to_string(),
            source_hosts: vec![format!("{id}.example.test")],
            path_prefix: String::new(),
            port: 8899,
        })
        .expect("profile should build")
    }

    fn test_rule(id: &str, local_response_id: Option<&str>) -> ProxyRule {
        ProxyRule {
            id: id.to_string(),
            source: RuleSource::Custom,
            source_operation_id: String::new(),
            apifox_web_url: String::new(),
            name: id.to_string(),
            method: "GET".to_string(),
            path: format!("/{id}"),
            match_mode: MatchMode::Exact,
            target: format!("https://mock.example.test/{id}"),
            enabled: true,
            tags: Vec::new(),
            priority: 100,
            local_response_id: local_response_id.map(str::to_string),
        }
    }

    fn test_apifox_rule(id: &str, source_operation_id: &str) -> ProxyRule {
        let mut rule = test_rule(id, None);
        rule.source = RuleSource::Apifox;
        rule.source_operation_id = source_operation_id.to_string();
        rule
    }
}
