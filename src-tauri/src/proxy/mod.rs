use std::future::Future;
use std::net::{SocketAddr, TcpListener};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{
        header::{HeaderValue, HOST},
        Request, Response, Uri,
    },
    rcgen::{Issuer, KeyPair},
    rustls::crypto::aws_lc_rs,
    Body, HttpContext, HttpHandler, Proxy, RequestOrResponse,
};
use regex::Regex;
use reqwest::Url;
use tokio::sync::oneshot;

use crate::model::{DesktopSnapshot, ProxyRule, ProxyStatus, RequestLog};
use crate::state::{AppState, ProxyRuntime};

#[derive(Clone)]
struct RuleProxyHandler {
    snapshot: Arc<Mutex<DesktopSnapshot>>,
    pending_log_id: Option<String>,
    started_at: Option<Instant>,
}

impl RuleProxyHandler {
    fn new(snapshot: Arc<Mutex<DesktopSnapshot>>) -> Self {
        Self {
            snapshot,
            pending_log_id: None,
            started_at: None,
        }
    }

    fn inspect_request(&mut self, request: &mut Request<Body>) {
        let source = request_source(request);
        let path = request.uri().path().to_string();
        let method = request.method().as_str().to_string();
        let Some(rule) = self.matching_rule(&method, &path) else {
            self.record_request(
                method,
                source.clone(),
                source,
                "未命中".to_string(),
                "passed".to_string(),
            );
            return;
        };

        let destination = rewrite_request(request, &rule);

        match destination {
            Ok(target) => {
                self.record_request(method, source, target, rule.name, "matched".to_string());
            }
            Err(error) => {
                self.record_request(method, source.clone(), source, error, "failed".to_string());
            }
        }
    }

    fn matching_rule(&self, method: &str, path: &str) -> Option<ProxyRule> {
        let snapshot = self.snapshot.lock().ok()?;
        let profile = snapshot
            .profiles
            .iter()
            .find(|profile| profile.id == snapshot.active_profile_id)?;

        profile
            .rules
            .iter()
            .find(|rule| rule_matches(rule, method, path))
            .cloned()
    }

    fn record_request(
        &mut self,
        method: String,
        source: String,
        destination: String,
        rule_name: String,
        status: String,
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
            rule_name,
            status,
            response_code: 0,
            duration: 0,
        };

        snapshot.logs.insert(0, log);
        snapshot.logs.truncate(200);
        self.pending_log_id = Some(log_id);
        self.started_at = Some(Instant::now());
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

        log.response_code = response.status().as_u16();

        if let Some(started_at) = self.started_at {
            log.duration = elapsed_millis(started_at);
        }
    }
}

impl HttpHandler for RuleProxyHandler {
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
}

pub fn start_proxy(state: &AppState) -> Result<DesktopSnapshot, String> {
    let port = active_proxy_port(state)?;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    validate_port(address)?;
    let material = state.certificate_material()?;
    let issuer = build_issuer(&material.certificate_pem, &material.private_key_pem)?;
    let authority = RcgenAuthority::new(issuer, 1_000, aws_lc_rs::default_provider());
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
    let snapshot_for_handler = Arc::clone(&state.snapshot);
    let proxy_runtime = Arc::clone(&state.proxy_runtime);
    let proxy = Proxy::builder()
        .with_addr(address)
        .with_ca(authority)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(RuleProxyHandler::new(snapshot_for_handler.clone()))
        .with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        })
        .build()
        .map_err(|error| format!("failed to build proxy: {error}"))?;

    {
        let mut runtime = state
            .proxy_runtime
            .lock()
            .map_err(|_| "proxy runtime is unavailable".to_string())?;

        if runtime.is_some() {
            return Err("proxy is already running".to_string());
        }

        *runtime = Some(ProxyRuntime {
            shutdown: shutdown_sender,
        });
    }

    {
        let mut snapshot = state
            .snapshot
            .lock()
            .map_err(|_| "desktop state is unavailable".to_string())?;
        snapshot.proxy_status = ProxyStatus::Running;
        snapshot.certificate.generated = true;
        snapshot.certificate.trusted = false;
        snapshot.certificate.fingerprint = material.fingerprint;
        state.persist(&snapshot)?;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(error) = proxy.start().await {
            if let Ok(mut snapshot) = snapshot_for_handler.lock() {
                snapshot.proxy_status = ProxyStatus::Error;
                snapshot.logs.insert(
                    0,
                    RequestLog {
                        id: create_log_id(),
                        created_at: current_timestamp(),
                        method: "SYSTEM".to_string(),
                        source: "local proxy".to_string(),
                        destination: String::new(),
                        rule_name: format!("Proxy error: {error}"),
                        status: "failed".to_string(),
                        response_code: 0,
                        duration: 0,
                    },
                );
            }

            if let Ok(mut runtime) = proxy_runtime.lock() {
                runtime.take();
            }
        }
    });

    let snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    Ok(snapshot.clone())
}

pub fn stop_proxy(state: &AppState) -> Result<DesktopSnapshot, String> {
    let runtime = state
        .proxy_runtime
        .lock()
        .map_err(|_| "proxy runtime is unavailable".to_string())?
        .take();

    if let Some(runtime) = runtime {
        let _ = runtime.shutdown.send(());
    }

    let mut snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    snapshot.proxy_status = ProxyStatus::Stopped;
    state.persist(&snapshot)?;
    Ok(snapshot.clone())
}

fn active_proxy_port(state: &AppState) -> Result<u16, String> {
    let snapshot = state
        .snapshot
        .lock()
        .map_err(|_| "desktop state is unavailable".to_string())?;
    let profile = snapshot
        .profiles
        .iter()
        .find(|profile| profile.id == snapshot.active_profile_id)
        .ok_or_else(|| "active profile was not found".to_string())?;

    Ok(profile.port)
}

fn validate_port(address: SocketAddr) -> Result<(), String> {
    let listener = TcpListener::bind(address)
        .map_err(|error| format!("proxy port {} is unavailable: {error}", address.port()))?;
    drop(listener);
    Ok(())
}

fn build_issuer(certificate: &str, private_key: &str) -> Result<Issuer<'static, KeyPair>, String> {
    let key_pair = KeyPair::from_pem(private_key)
        .map_err(|error| format!("failed to load CA private key: {error}"))?;

    Issuer::from_ca_cert_pem(certificate, key_pair)
        .map_err(|error| format!("failed to load CA certificate: {error}"))
}

fn rule_matches(rule: &ProxyRule, method: &str, path: &str) -> bool {
    if !rule.enabled || rule.method != method {
        return false;
    }

    match rule.match_mode.as_str() {
        "exact" => rule.path == path,
        "contains" => path.contains(&rule.path),
        "regex" => regex_matches(&rule.path, path),
        _ => false,
    }
}

fn regex_matches(pattern: &str, path: &str) -> bool {
    let expression = Regex::new(pattern);

    if let Ok(expression) = expression {
        return expression.is_match(path);
    }

    false
}

fn rewrite_request(request: &mut Request<Body>, rule: &ProxyRule) -> Result<String, String> {
    let mut target =
        Url::parse(&rule.target).map_err(|error| format!("Mock target is invalid: {error}"))?;
    let request_query = request.uri().query().map(ToString::to_string);
    target.set_query(request_query.as_deref());
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
    let host = request
        .headers()
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown-host");

    format!("{host}{}", request.uri())
}

fn current_timestamp() -> String {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH);

    if let Ok(duration) = duration {
        return format!("{}", duration.as_secs());
    }

    "0".to_string()
}

fn create_log_id() -> String {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH);

    if let Ok(duration) = duration {
        return format!("request-{}", duration.as_nanos());
    }

    "request-0".to_string()
}

fn elapsed_millis(started_at: Instant) -> u16 {
    let elapsed = started_at.elapsed().as_millis();

    match u16::try_from(elapsed) {
        Ok(value) => value,
        Err(_) => u16::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::{rewrite_request, rule_matches};
    use crate::model::ProxyRule;
    use hudsucker::{hyper::header::HOST, Body};

    fn rule(match_mode: &str, path: &str) -> ProxyRule {
        ProxyRule {
            id: "rule".to_string(),
            name: "Rule".to_string(),
            method: "GET".to_string(),
            path: path.to_string(),
            match_mode: match_mode.to_string(),
            target: "https://mock.example.test".to_string(),
            enabled: true,
            tag: "tag".to_string(),
        }
    }

    #[test]
    fn matches_all_supported_rule_modes() {
        assert!(rule_matches(
            &rule("exact", "/v1/orders"),
            "GET",
            "/v1/orders"
        ));
        assert!(rule_matches(
            &rule("contains", "/orders"),
            "GET",
            "/v1/orders/42"
        ));
        assert!(rule_matches(
            &rule("regex", r"^/v1/orders/\d+$"),
            "GET",
            "/v1/orders/42"
        ));
    }

    #[test]
    fn rewrites_target_and_preserves_query() {
        let mut request = hudsucker::hyper::Request::builder()
            .uri("http://api.dev.acme.test/v1/products?page=1")
            .header(HOST, "api.dev.acme.test")
            .body(Body::empty())
            .expect("request should be valid");
        let rule = rule("exact", "/v1/products");

        let target = rewrite_request(&mut request, &rule).expect("request should be rewritten");

        assert_eq!(target, "https://mock.example.test/?page=1");
        assert_eq!(
            request.uri().to_string(),
            "https://mock.example.test/?page=1"
        );
        assert_eq!(
            request
                .headers()
                .get(HOST)
                .and_then(|value| value.to_str().ok()),
            Some("mock.example.test")
        );
    }
}
