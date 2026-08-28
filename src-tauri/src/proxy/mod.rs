use std::collections::BTreeMap;
use std::future::Future;
use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{
        header::{HeaderValue, HOST},
        Request, Response, StatusCode, Uri,
    },
    rcgen::{Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    Body, HttpContext, HttpHandler, Proxy, RequestOrResponse,
};
use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration};
use url::Url;

use crate::model::{
    DesktopSnapshot, MatchMode, ProjectProfile, ProxyRule, ProxyStatus, RequestLog,
};
use crate::state::{AppState, ProxyRuntime};

#[derive(Clone)]
struct RuleProxyHandler {
    snapshot: Arc<Mutex<DesktopSnapshot>>,
    app: Option<AppHandle>,
    profile_id: String,
    mock_token: Arc<Mutex<Option<String>>>,
    pending_log_id: Option<String>,
    started_at: Option<Instant>,
}

impl RuleProxyHandler {
    fn new(
        snapshot: Arc<Mutex<DesktopSnapshot>>,
        app: AppHandle,
        profile_id: String,
        mock_token: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            snapshot,
            app: Some(app),
            profile_id,
            mock_token,
            pending_log_id: None,
            started_at: None,
        }
    }

    #[cfg(test)]
    fn without_events(
        snapshot: Arc<Mutex<DesktopSnapshot>>,
        profile_id: String,
        mock_token: Option<String>,
    ) -> Self {
        Self {
            snapshot,
            app: None,
            profile_id,
            mock_token: Arc::new(Mutex::new(mock_token)),
            pending_log_id: None,
            started_at: None,
        }
    }

    #[cfg(test)]
    fn update_mock_token(&self, token: &str) {
        if let Ok(mut current) = self.mock_token.lock() {
            *current = Some(token.to_string());
        }
    }

    fn inspect_request(&mut self, request: &mut Request<Body>) {
        let source = sanitize_url(&request_source(request));
        let path = request.uri().path().to_string();
        let method = request.method().as_str().to_string();
        let host = request_host(request);
        let decision = self.matching_rule(&method, &host, &path);
        let Some(rule) = decision.rule else {
            self.record_request(
                method,
                source.clone(),
                source,
                String::new(),
                "未命中".to_string(),
                String::new(),
                "passed".to_string(),
                decision.stage,
            );
            return;
        };

        let mock_token = self.mock_token.lock().ok().and_then(|token| token.clone());
        match rewrite_request(request, &rule, mock_token.as_deref()) {
            Ok(target) => {
                let tag = rule.tags.first().cloned().unwrap_or_default();
                self.record_request(
                    method,
                    source,
                    sanitize_url(&target),
                    rule.id,
                    rule.name,
                    tag,
                    "matched".to_string(),
                    "rule".to_string(),
                );
            }
            Err(error) => {
                self.record_request(
                    method,
                    source.clone(),
                    source,
                    rule.id,
                    rule.name,
                    String::new(),
                    "failed".to_string(),
                    error,
                );
            }
        }
    }

    fn matching_rule(&self, method: &str, host: &str, path: &str) -> MatchDecision {
        let Ok(snapshot) = self.snapshot.lock() else {
            return MatchDecision::miss("state");
        };
        let Some(profile) = snapshot
            .profiles
            .iter()
            .find(|profile| profile.id == self.profile_id)
        else {
            return MatchDecision::miss("profile");
        };
        if !host_matches(profile, host) {
            return MatchDecision::miss("host");
        }
        if !profile.path_prefix.is_empty() && !path.starts_with(&profile.path_prefix) {
            return MatchDecision::miss("path-prefix");
        }
        if !profile.global_mock_enabled {
            return MatchDecision::miss("global-switch");
        }
        let rule = profile
            .rules
            .iter()
            .filter(|rule| rule_matches(rule, method, path))
            .max_by_key(|rule| (rule.priority, match_specificity(rule.match_mode)))
            .cloned();
        if rule.is_some() {
            return MatchDecision {
                rule,
                stage: "rule".to_string(),
            };
        }
        MatchDecision::miss("rule")
    }

    #[allow(clippy::too_many_arguments)]
    fn record_request(
        &mut self,
        method: String,
        source: String,
        destination: String,
        rule_id: String,
        rule_name: String,
        tag: String,
        status: String,
        stage: String,
    ) {
        let Ok(mut snapshot) = self.snapshot.lock() else {
            return;
        };
        let log_id = create_log_id();
        let log = RequestLog {
            id: log_id.clone(),
            created_at: current_timestamp(),
            method,
            source,
            destination,
            rule_id,
            rule_name,
            tag,
            status,
            stage,
            response_code: None,
            duration: 0,
        };
        snapshot.logs.insert(0, log.clone());
        snapshot.logs.truncate(500);
        self.pending_log_id = Some(log_id);
        self.started_at = Some(Instant::now());
        if let Some(app) = &self.app {
            let _ = app.emit("proxy://request", log);
        }
    }

    fn record_response(&mut self, response: &Response<Body>) {
        let Some(log_id) = self.pending_log_id.as_ref() else {
            return;
        };
        let Ok(mut snapshot) = self.snapshot.lock() else {
            return;
        };
        let Some(log) = snapshot.logs.iter_mut().find(|log| &log.id == log_id) else {
            return;
        };
        log.response_code = Some(response.status().as_u16());
        if let Some(started_at) = self.started_at {
            log.duration = elapsed_millis(started_at);
        }
        if let Some(app) = &self.app {
            let _ = app.emit("proxy://request", log.clone());
        }
    }

    fn record_failure(&mut self, stage: &str) {
        let Some(log_id) = self.pending_log_id.as_ref() else {
            return;
        };
        let Ok(mut snapshot) = self.snapshot.lock() else {
            return;
        };
        let Some(log) = snapshot.logs.iter_mut().find(|log| &log.id == log_id) else {
            return;
        };
        log.status = "failed".to_string();
        log.stage = stage.to_string();
        log.response_code = Some(StatusCode::BAD_GATEWAY.as_u16());
        if let Some(started_at) = self.started_at {
            log.duration = elapsed_millis(started_at);
        }
        if let Some(app) = &self.app {
            let _ = app.emit("proxy://request", log.clone());
        }
    }
}

impl RuleProxyHandler {
    fn mock_enabled(&self) -> bool {
        let Ok(snapshot) = self.snapshot.lock() else {
            return false;
        };
        snapshot
            .profiles
            .iter()
            .find(|profile| profile.id == self.profile_id)
            .map(|profile| profile.global_mock_enabled)
            .unwrap_or(false)
    }
}

impl HttpHandler for RuleProxyHandler {
    fn should_intercept_connect(
        &mut self,
        _context: &HttpContext,
        _request: &Request<Body>,
    ) -> impl Future<Output = bool> + Send {
        let intercept = self.mock_enabled();
        async move { intercept }
    }

    fn should_intercept_tls(
        &mut self,
        _context: &HttpContext,
        _client_hello: hudsucker::rustls::server::ClientHello<'_>,
    ) -> impl Future<Output = bool> + Send {
        let intercept = self.mock_enabled();
        async move { intercept }
    }

    fn handle_request(
        &mut self,
        _context: &HttpContext,
        mut request: Request<Body>,
    ) -> impl Future<Output = RequestOrResponse> + Send {
        self.inspect_request(&mut request);
        async move { request.into() }
    }

    fn handle_response(
        &mut self,
        _context: &HttpContext,
        response: Response<Body>,
    ) -> impl Future<Output = Response<Body>> + Send {
        self.record_response(&response);
        async move { response }
    }

    fn handle_error(
        &mut self,
        _context: &HttpContext,
        _error: hyper_util::client::legacy::Error,
    ) -> impl Future<Output = Response<Body>> + Send {
        self.record_failure("upstream-request");
        async move {
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::empty())
                .expect("502 response should be valid")
        }
    }
}

struct MatchDecision {
    rule: Option<ProxyRule>,
    stage: String,
}

impl MatchDecision {
    fn miss(stage: &str) -> Self {
        Self {
            rule: None,
            stage: stage.to_string(),
        }
    }
}

pub async fn start_proxy(app: &AppHandle, state: &AppState) -> Result<DesktopSnapshot, String> {
    {
        let runtime = state
            .proxy_runtime
            .lock()
            .map_err(|_| "proxy runtime is unavailable".to_string())?;
        if runtime.is_some() {
            return Err("proxy is already running".to_string());
        }
    }
    let profile = active_profile(state)?;
    set_proxy_status(app, state, ProxyStatus::Starting);
    let address = SocketAddr::from(([127, 0, 0, 1], profile.port));
    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            set_proxy_status(app, state, ProxyStatus::Error);
            return Err(format!(
                "proxy port {} is unavailable: {error}",
                address.port()
            ));
        }
    };
    let material = match state.certificate_material() {
        Ok(material) => material,
        Err(error) => {
            set_proxy_status(app, state, ProxyStatus::Error);
            return Err(error);
        }
    };
    let issuer = match build_issuer(&material.certificate_pem, &material.private_key_pem) {
        Ok(issuer) => issuer,
        Err(error) => {
            set_proxy_status(app, state, ProxyStatus::Error);
            return Err(error);
        }
    };
    let authority = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());
    let mock_token = resolve_mock_token(&profile);
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
    let snapshot_for_handler = Arc::clone(&state.snapshot);
    let snapshot_for_task = Arc::clone(&state.snapshot);
    let runtime_for_task = Arc::clone(&state.proxy_runtime);
    let app_for_task = app.clone();
    let runtime_mock_token = Arc::new(Mutex::new(mock_token));
    let handler = RuleProxyHandler::new(
        snapshot_for_handler,
        app.clone(),
        profile.id.clone(),
        Arc::clone(&runtime_mock_token),
    );
    let proxy = Proxy::builder()
        .with_listener(listener)
        .with_ca(authority)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler)
        .with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        })
        .build();
    let proxy = match proxy {
        Ok(proxy) => proxy,
        Err(error) => {
            set_proxy_status(app, state, ProxyStatus::Error);
            return Err(format!("failed to build proxy: {error}"));
        }
    };

    {
        let mut runtime = state
            .proxy_runtime
            .lock()
            .map_err(|_| "proxy runtime is unavailable".to_string())?;
        *runtime = Some(ProxyRuntime {
            shutdown: shutdown_sender,
            profile_id: profile.id.clone(),
            port: profile.port,
            mock_token: runtime_mock_token,
        });
    }
    {
        let mut snapshot = state
            .snapshot
            .lock()
            .map_err(|_| "desktop state is unavailable".to_string())?;
        snapshot.certificate.generated = true;
        snapshot.certificate.fingerprint = material.fingerprint;
        snapshot.certificate.certificate_path =
            material.certificate_path.to_string_lossy().to_string();
    }
    set_proxy_status(app, state, ProxyStatus::Running);

    tauri::async_runtime::spawn(async move {
        let result = proxy.start().await;
        let stopped = snapshot_for_task
            .lock()
            .map(|snapshot| snapshot.proxy_status == ProxyStatus::Stopped)
            .unwrap_or(false);
        if let Err(error) = result {
            if !stopped {
                if let Ok(mut snapshot) = snapshot_for_task.lock() {
                    snapshot.proxy_status = ProxyStatus::Error;
                    let log = system_error_log(&error.to_string());
                    snapshot.logs.insert(0, log.clone());
                    let _ = app_for_task.emit("proxy://request", log);
                    let _ = app_for_task.emit("proxy://snapshot", snapshot.clone());
                }
            }
        }
        if let Ok(mut runtime) = runtime_for_task.lock() {
            runtime.take();
        }
    });
    snapshot(state)
}

pub fn stop_proxy(app: &AppHandle, state: &AppState) -> Result<DesktopSnapshot, String> {
    let runtime = state
        .proxy_runtime
        .lock()
        .map_err(|_| "proxy runtime is unavailable".to_string())?
        .take();
    if let Some(runtime) = runtime {
        let _ = runtime.shutdown.send(());
    }
    set_proxy_status(app, state, ProxyStatus::Stopped);
    snapshot(state)
}

pub async fn ensure_proxy_running(
    app: &AppHandle,
    state: &AppState,
) -> Result<DesktopSnapshot, String> {
    let desired = active_profile(state)?;
    let same_listener = {
        let current_runtime = state
            .proxy_runtime
            .lock()
            .map_err(|_| "proxy runtime is unavailable".to_string())?;
        current_runtime
            .as_ref()
            .map(|runtime| runtime.profile_id == desired.id && runtime.port == desired.port)
            .unwrap_or(false)
    };
    if same_listener {
        return snapshot(state);
    }
    if proxy_is_running(state)? {
        stop_proxy(app, state)?;
        sleep(Duration::from_millis(100)).await;
    }
    start_proxy(app, state).await
}

pub fn proxy_is_running(state: &AppState) -> Result<bool, String> {
    state
        .proxy_runtime
        .lock()
        .map(|runtime| runtime.is_some())
        .map_err(|_| "proxy runtime is unavailable".to_string())
}

fn active_profile(state: &AppState) -> Result<ProjectProfile, String> {
    let snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    let active_id = snapshot
        .active_profile_id
        .as_ref()
        .ok_or_else(|| "Create and select a project before starting the proxy".to_string())?;
    snapshot
        .profiles
        .iter()
        .find(|profile| &profile.id == active_id)
        .cloned()
        .ok_or_else(|| "active profile was not found".to_string())
}

fn resolve_mock_token(profile: &ProjectProfile) -> Option<String> {
    let token = profile.apifox.mock_token.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn set_proxy_status(app: &AppHandle, state: &AppState, status: ProxyStatus) {
    if let Ok(mut snapshot) = state.snapshot.lock() {
        snapshot.proxy_status = status;
        let _ = app.emit("proxy://snapshot", snapshot.clone());
    }
}

fn snapshot(state: &AppState) -> Result<DesktopSnapshot, String> {
    state
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|_| "desktop state is unavailable".to_string())
}

fn build_issuer(certificate: &str, private_key: &str) -> Result<Issuer<'static, KeyPair>, String> {
    let key_pair = KeyPair::from_pem(private_key)
        .map_err(|error| format!("failed to load CA private key: {error}"))?;
    Issuer::from_ca_cert_pem(certificate, key_pair)
        .map_err(|error| format!("failed to load CA certificate: {error}"))
}

fn host_matches(profile: &ProjectProfile, request_host: &str) -> bool {
    let request_host = normalize_request_host(request_host);
    profile
        .source_hosts
        .iter()
        .any(|host| normalize_request_host(host) == request_host)
}

fn normalize_request_host(host: &str) -> String {
    let value = host.trim().to_lowercase();
    if value.starts_with('[') {
        return value
            .split(']')
            .next()
            .map(|host| format!("{host}]"))
            .unwrap_or(value);
    }
    value.split(':').next().unwrap_or(&value).to_string()
}

fn request_host(request: &Request<Body>) -> String {
    request
        .uri()
        .host()
        .or_else(|| {
            request
                .headers()
                .get(HOST)
                .and_then(|value| value.to_str().ok())
        })
        .unwrap_or_default()
        .to_string()
}

fn rule_matches(rule: &ProxyRule, method: &str, path: &str) -> bool {
    if !rule.enabled || rule.method != method {
        return false;
    }
    match rule.match_mode {
        MatchMode::Exact => rule.path == path,
        MatchMode::Contains => path.contains(&rule.path),
        MatchMode::Regex => regex_matches(&rule.path, path),
        MatchMode::Template => template_matches(&rule.path, path),
    }
}

fn match_specificity(mode: MatchMode) -> i32 {
    match mode {
        MatchMode::Exact => 4,
        MatchMode::Template => 3,
        MatchMode::Regex => 2,
        MatchMode::Contains => 1,
    }
}

fn regex_matches(pattern: &str, path: &str) -> bool {
    Regex::new(pattern)
        .map(|expression| expression.is_match(path))
        .unwrap_or(false)
}

fn template_matches(pattern: &str, path: &str) -> bool {
    let expression = template_expression(pattern);
    regex_matches(&expression, path)
}

fn template_expression(pattern: &str) -> String {
    let segments = pattern
        .split('/')
        .map(|segment| {
            if segment.starts_with('{') && segment.ends_with('}') {
                return "[^/]+".to_string();
            }
            regex::escape(segment)
        })
        .collect::<Vec<_>>();
    format!("^{}/*$", segments.join("/"))
}

fn rewrite_request(
    request: &mut Request<Body>,
    rule: &ProxyRule,
    mock_token: Option<&str>,
) -> Result<String, String> {
    let mut target =
        Url::parse(&rule.target).map_err(|error| format!("Mock target is invalid: {error}"))?;
    if rule.match_mode == MatchMode::Template {
        let target_path = target.path().to_string();
        let template_url = Url::parse(&format!("https://template.invalid{}", rule.path))
            .map_err(|error| format!("Rule template path is invalid: {error}"))?;
        if let Some(prefix) = target_path.strip_suffix(template_url.path()) {
            target.set_path(&format!("{prefix}{}", request.uri().path()));
        }
    }
    let mut query = target
        .query_pairs()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<BTreeMap<_, _>>();
    if let Some(request_query) = request.uri().query() {
        for (key, value) in url::form_urlencoded::parse(request_query.as_bytes()) {
            query.insert(key.to_string(), value.to_string());
        }
    }
    if let Some(token) = mock_token.filter(|value| !value.is_empty()) {
        query.insert("apifoxToken".to_string(), token.to_string());
    }
    target.set_query(None);
    if !query.is_empty() {
        let mut serializer = target.query_pairs_mut();
        for (key, value) in query {
            serializer.append_pair(&key, &value);
        }
    }
    let host = target
        .host_str()
        .ok_or_else(|| "Mock target does not include a host".to_string())?;
    let host_value = build_host_value(host, target.port());
    let target_uri = Uri::from_str(target.as_str())
        .map_err(|error| format!("Mock target URI is invalid: {error}"))?;
    let header_value = HeaderValue::from_str(&host_value)
        .map_err(|error| format!("Mock target host is invalid: {error}"))?;
    *request.uri_mut() = target_uri;
    request.headers_mut().insert(HOST, header_value);
    Ok(target.to_string())
}

fn build_host_value(host: &str, port: Option<u16>) -> String {
    if let Some(port) = port {
        return format!("{host}:{port}");
    }
    host.to_string()
}

fn request_source(request: &Request<Body>) -> String {
    if request.uri().scheme().is_some() {
        return request.uri().to_string();
    }
    let host = request_host(request);
    format!("https://{host}{}", request.uri())
}

fn sanitize_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value.to_string();
    };
    let query = url
        .query_pairs()
        .filter(|(key, _)| key != "apifoxToken" && key != "token")
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<Vec<_>>();
    url.set_query(None);
    if !query.is_empty() {
        let mut serializer = url.query_pairs_mut();
        for (key, value) in query {
            serializer.append_pair(&key, &value);
        }
    }
    url.to_string()
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn create_log_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("request-{timestamp}")
}

fn elapsed_millis(started_at: Instant) -> u64 {
    u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn system_error_log(error: &str) -> RequestLog {
    RequestLog {
        id: create_log_id(),
        created_at: current_timestamp(),
        method: "SYSTEM".to_string(),
        source: "local proxy".to_string(),
        destination: String::new(),
        rule_id: String::new(),
        rule_name: "Proxy runtime error".to_string(),
        tag: String::new(),
        status: "failed".to_string(),
        stage: error.to_string(),
        response_code: None,
        duration: 0,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{build_issuer, rewrite_request, template_matches, RuleProxyHandler};
    use crate::model::{
        ApifoxConnection, DesktopSnapshot, MatchMode, ProjectProfile, ProxyRule, RuleSource,
    };
    use crate::state::AppState;
    use hudsucker::rcgen::{
        CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, KeyPair,
        KeyUsagePurpose,
    };
    use hudsucker::rustls::{
        pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
        ClientConfig, RootCertStore, ServerConfig,
    };
    use hudsucker::{
        certificate_authority::RcgenAuthority, hyper::header::HOST, rustls::crypto::aws_lc_rs,
        Body, Proxy,
    };
    use hyper_rustls::HttpsConnectorBuilder;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    fn profile() -> ProjectProfile {
        ProjectProfile {
            id: "profile".to_string(),
            name: "Profile".to_string(),
            source_hosts: vec!["api.example.test".to_string()],
            path_prefix: "/v1".to_string(),
            port: 8899,
            apifox: ApifoxConnection::default(),
            synced_tags: vec!["订单".to_string()],
            active_tags: vec!["订单".to_string()],
            global_mock_enabled: true,
            rules: Vec::new(),
        }
    }

    fn rule(mode: MatchMode, path: &str) -> ProxyRule {
        ProxyRule {
            id: "rule".to_string(),
            source: RuleSource::Apifox,
            source_operation_id: "source".to_string(),
            apifox_web_url: String::new(),
            name: "Rule".to_string(),
            method: "GET".to_string(),
            path: path.to_string(),
            match_mode: mode,
            target: format!("https://mock.example.test/mock{path}"),
            enabled: true,
            tags: vec!["订单".to_string()],
            priority: 100,
        }
    }

    #[test]
    fn matches_synced_rules_without_active_tag_scope() {
        let mut profile = profile();
        profile.active_tags.clear();
        let template = rule(MatchMode::Template, "/v1/orders/{id}");
        profile.rules.push(template);
        let profile_id = profile.id.clone();
        let snapshot = Arc::new(Mutex::new(DesktopSnapshot {
            profiles: vec![profile],
            active_profile_id: Some(profile_id.clone()),
            ..DesktopSnapshot::default()
        }));
        let handler = RuleProxyHandler::without_events(snapshot, profile_id, None);
        assert!(handler
            .matching_rule("GET", "api.example.test", "/v1/orders/42")
            .rule
            .is_some());
        assert!(template_matches(
            "/v1/orders/{id}/items/{itemId}",
            "/v1/orders/42/items/9"
        ));
    }

    #[test]
    fn global_mock_switch_passes_through_without_changing_rule_state() {
        let mut profile = profile();
        profile.global_mock_enabled = false;
        profile
            .rules
            .push(rule(MatchMode::Template, "/v1/orders/{id}"));
        let profile_id = profile.id.clone();
        let snapshot = Arc::new(Mutex::new(DesktopSnapshot {
            profiles: vec![profile],
            active_profile_id: Some(profile_id.clone()),
            ..DesktopSnapshot::default()
        }));
        let handler = RuleProxyHandler::without_events(Arc::clone(&snapshot), profile_id, None);

        let decision = handler.matching_rule("GET", "api.example.test", "/v1/orders/42");

        assert!(decision.rule.is_none());
        assert_eq!(decision.stage, "global-switch");
        assert!(snapshot.lock().expect("snapshot should unlock").profiles[0].rules[0].enabled);
    }

    #[test]
    fn rewrites_template_path_and_merges_query_and_token() {
        let mut request = hudsucker::hyper::Request::builder()
            .uri("http://api.example.test/v1/orders/42?page=2&apifoxToken=request-old")
            .header(HOST, "api.example.test")
            .body(Body::empty())
            .expect("request should be valid");
        let mut proxy_rule = rule(MatchMode::Template, "/v1/orders/{id}");
        proxy_rule.target.push_str("?apifoxToken=rule-old");
        let target = rewrite_request(&mut request, &proxy_rule, Some("secret"))
            .expect("request should rewrite");
        assert_eq!(
            target,
            "https://mock.example.test/mock/v1/orders/42?apifoxToken=secret&page=2"
        );
        assert_eq!(
            request
                .headers()
                .get(HOST)
                .and_then(|value| value.to_str().ok()),
            Some("mock.example.test")
        );
    }

    #[test]
    fn running_handler_uses_updated_mock_token() {
        let mut profile = profile();
        profile
            .rules
            .push(rule(MatchMode::Template, "/v1/orders/{id}"));
        let profile_id = profile.id.clone();
        let snapshot = Arc::new(Mutex::new(DesktopSnapshot {
            profiles: vec![profile],
            active_profile_id: Some(profile_id.clone()),
            ..DesktopSnapshot::default()
        }));
        let mut handler = RuleProxyHandler::without_events(snapshot, profile_id, None);
        handler.update_mock_token("latest-mock-token");
        let mut request = hudsucker::hyper::Request::builder()
            .uri("http://api.example.test/v1/orders/42?page=2")
            .header(HOST, "api.example.test")
            .body(Body::empty())
            .expect("request should be valid");

        handler.inspect_request(&mut request);

        assert!(request
            .uri()
            .query()
            .expect("rewritten request should have a query")
            .contains("apifoxToken=latest-mock-token"));
    }

    #[tokio::test]
    async fn proxies_http_request_to_rewritten_upstream() {
        let upstream = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("upstream should bind");
        let upstream_port = upstream.local_addr().expect("upstream address").port();
        let upstream_task = tokio::spawn(async move {
            let (mut stream, _) = upstream.accept().await.expect("upstream request");
            let mut request = vec![0_u8; 4096];
            let length = stream
                .read(&mut request)
                .await
                .expect("request should read");
            let request = String::from_utf8_lossy(&request[..length]).to_string();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .expect("response should write");
            request
        });

        let proxy_listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("proxy should bind");
        let proxy_address = proxy_listener.local_addr().expect("proxy address");
        let directory = temporary_directory("apifox-proxy-http-e2e");
        let state = AppState::load(directory.clone()).expect("state should initialize");
        let material = state
            .certificate_material()
            .expect("certificate should generate");
        let issuer = build_issuer(&material.certificate_pem, &material.private_key_pem)
            .expect("issuer should build");
        let authority = RcgenAuthority::new(issuer, 100, aws_lc_rs::default_provider());
        let mut profile = profile();
        let mut proxy_rule = rule(MatchMode::Template, "/v1/orders/{id}");
        proxy_rule.target = format!("http://127.0.0.1:{upstream_port}/mock/v1/orders/{{id}}");
        profile.rules.push(proxy_rule);
        let profile_id = profile.id.clone();
        let snapshot = Arc::new(Mutex::new(DesktopSnapshot {
            profiles: vec![profile],
            active_profile_id: Some(profile_id.clone()),
            ..DesktopSnapshot::default()
        }));
        let handler = RuleProxyHandler::without_events(snapshot.clone(), profile_id, None);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let proxy = Proxy::builder()
            .with_listener(proxy_listener)
            .with_ca(authority)
            .with_rustls_connector(aws_lc_rs::default_provider())
            .with_http_handler(handler)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .build()
            .expect("proxy should build");
        let proxy_task = tokio::spawn(proxy.start());
        let client = reqwest::Client::builder()
            .proxy(
                reqwest::Proxy::all(format!("http://{proxy_address}"))
                    .expect("proxy URL should parse"),
            )
            .build()
            .expect("client should build");
        let response = client
            .get("http://api.example.test/v1/orders/42?page=2")
            .send()
            .await
            .expect("proxied request should succeed");
        assert_eq!(response.text().await.expect("response body"), "ok");
        let upstream_request = upstream_task.await.expect("upstream task should finish");
        assert!(upstream_request.starts_with("GET /mock/v1/orders/42?page=2 HTTP/1.1"));
        assert!(upstream_request.contains(&format!("host: 127.0.0.1:{upstream_port}")));
        let logs = snapshot
            .lock()
            .expect("snapshot should unlock")
            .logs
            .clone();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, "matched");
        assert_eq!(logs[0].response_code, Some(200));
        let _ = shutdown_tx.send(());
        proxy_task
            .await
            .expect("proxy task should finish")
            .expect("proxy should stop cleanly");
        std::fs::remove_dir_all(directory).expect("test directory should remove");
    }

    #[tokio::test]
    async fn proxies_https_connect_with_generated_ca() {
        let directory = temporary_directory("apifox-proxy-https-e2e");
        let state = AppState::load(directory.clone()).expect("state should initialize");
        let material = state
            .certificate_material()
            .expect("certificate should generate");
        let upstream = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("TLS upstream should bind");
        let upstream_port = upstream.local_addr().expect("upstream address").port();
        let upstream_config =
            test_server_config(&material.certificate_pem, &material.private_key_pem);
        let upstream_task = tokio::spawn(async move {
            let (stream, _) = upstream.accept().await.expect("TLS upstream request");
            let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(upstream_config));
            let mut stream = acceptor.accept(stream).await.expect("TLS should negotiate");
            let mut request = vec![0_u8; 4096];
            let length = stream
                .read(&mut request)
                .await
                .expect("request should read");
            let request = String::from_utf8_lossy(&request[..length]).to_string();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecure",
                )
                .await
                .expect("response should write");
            request
        });

        let proxy_listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("proxy should bind");
        let proxy_address = proxy_listener.local_addr().expect("proxy address");
        let proxy_issuer = build_issuer(&material.certificate_pem, &material.private_key_pem)
            .expect("issuer should build");
        let authority = RcgenAuthority::new(proxy_issuer, 100, aws_lc_rs::default_provider());
        let connector = test_https_connector(&material.certificate_pem);
        let mut profile = profile();
        let mut proxy_rule = rule(MatchMode::Template, "/v1/orders/{id}");
        proxy_rule.target = format!("https://127.0.0.1:{upstream_port}/mock/v1/orders/{{id}}");
        profile.rules.push(proxy_rule);
        let profile_id = profile.id.clone();
        let snapshot = Arc::new(Mutex::new(DesktopSnapshot {
            profiles: vec![profile],
            active_profile_id: Some(profile_id.clone()),
            ..DesktopSnapshot::default()
        }));
        let handler = RuleProxyHandler::without_events(snapshot.clone(), profile_id, None);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let proxy = Proxy::builder()
            .with_listener(proxy_listener)
            .with_ca(authority)
            .with_http_connector(connector)
            .with_http_handler(handler)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .build()
            .expect("proxy should build");
        let proxy_task = tokio::spawn(proxy.start());
        let ca = reqwest::Certificate::from_pem(material.certificate_pem.as_bytes())
            .expect("client CA should parse");
        let client = reqwest::Client::builder()
            .add_root_certificate(ca)
            .proxy(reqwest::Proxy::all(format!("http://{proxy_address}")).expect("proxy URL"))
            .build()
            .expect("client should build");
        let response = client
            .get("https://api.example.test/v1/orders/42?mode=https")
            .send()
            .await
            .expect("HTTPS request through CONNECT should succeed");
        assert_eq!(response.text().await.expect("response body"), "secure");
        let request = upstream_task.await.expect("upstream task should finish");
        assert!(request.starts_with("GET /mock/v1/orders/42?mode=https HTTP/1.1"));
        let logs = snapshot
            .lock()
            .expect("snapshot should unlock")
            .logs
            .clone();
        assert_eq!(logs[0].status, "matched");
        assert_eq!(logs[0].response_code, Some(200));
        let _ = shutdown_tx.send(());
        proxy_task
            .await
            .expect("proxy task should finish")
            .expect("proxy should stop cleanly");
        std::fs::remove_dir_all(directory).expect("test directory should remove");
    }

    fn test_server_config(certificate_pem: &str, private_key_pem: &str) -> ServerConfig {
        let issuer = build_issuer(certificate_pem, private_key_pem).expect("issuer should build");
        let mut params = CertificateParams::new(vec!["127.0.0.1".to_string()])
            .expect("server params should build");
        params.distinguished_name = DistinguishedName::new();
        params
            .distinguished_name
            .push(DnType::CommonName, "127.0.0.1");
        params.key_usages.push(KeyUsagePurpose::DigitalSignature);
        params
            .extended_key_usages
            .push(ExtendedKeyUsagePurpose::ServerAuth);
        let key = KeyPair::generate().expect("server key should generate");
        let certificate = params
            .signed_by(&key, &issuer)
            .expect("server certificate should sign");
        let private_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der()));
        ServerConfig::builder_with_provider(Arc::new(aws_lc_rs::default_provider()))
            .with_safe_default_protocol_versions()
            .expect("TLS protocols should configure")
            .with_no_client_auth()
            .with_single_cert(vec![certificate.der().clone()], private_key)
            .expect("server TLS config should build")
    }

    fn test_https_connector(
        certificate_pem: &str,
    ) -> impl hyper_util::client::legacy::connect::Connect + Clone {
        let mut roots = RootCertStore::empty();
        let certificate = CertificateDer::from_pem_slice(certificate_pem.as_bytes())
            .expect("CA certificate should parse");
        roots.add(certificate).expect("CA should add to roots");
        let config = ClientConfig::builder_with_provider(Arc::new(aws_lc_rs::default_provider()))
            .with_safe_default_protocol_versions()
            .expect("TLS protocols should configure")
            .with_root_certificates(roots)
            .with_no_client_auth();
        HttpsConnectorBuilder::new()
            .with_tls_config(config)
            .https_or_http()
            .enable_http1()
            .build()
    }

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("{name}-{timestamp}"))
    }
}
