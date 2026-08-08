use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub profiles: Vec<ProjectProfile>,
    pub active_profile_id: String,
    pub proxy_status: ProxyStatus,
    pub certificate: CertificateStatus,
    pub logs: Vec<RequestLog>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfile {
    pub id: String,
    pub name: String,
    pub domain: String,
    pub port: u16,
    pub apifox: ApifoxConnection,
    pub rules: Vec<ProxyRule>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApifoxConnection {
    pub mode: String,
    pub source: String,
    pub mock_prefix: String,
    pub selected_tags: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRule {
    pub id: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub match_mode: String,
    pub target: String,
    pub enabled: bool,
    pub tag: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateStatus {
    pub generated: bool,
    pub trusted: bool,
    pub fingerprint: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub created_at: String,
    pub method: String,
    pub source: String,
    pub destination: String,
    pub rule_name: String,
    pub status: String,
    pub response_code: u16,
    pub duration: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiSyncRequest {
    pub profile_id: String,
    pub mode: String,
    pub source_url: String,
    pub mock_prefix: String,
    pub selected_tags: Vec<String>,
    pub access_token: Option<String>,
}
