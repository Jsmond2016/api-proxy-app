use serde::{Deserialize, Serialize};

pub const CURRENT_SCHEMA_VERSION: u32 = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub schema_version: u32,
    pub profiles: Vec<ProjectProfile>,
    pub active_profile_id: Option<String>,
    pub proxy_status: ProxyStatus,
    pub certificate: CertificateStatus,
    pub logs: Vec<RequestLog>,
}

impl Default for DesktopSnapshot {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            profiles: Vec::new(),
            active_profile_id: None,
            proxy_status: ProxyStatus::Stopped,
            certificate: CertificateStatus::default(),
            logs: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfile {
    pub id: String,
    pub name: String,
    pub source_hosts: Vec<String>,
    pub path_prefix: String,
    pub port: u16,
    pub apifox: ApifoxConnection,
    pub synced_tags: Vec<String>,
    pub active_tags: Vec<String>,
    #[serde(default = "default_global_mock_enabled")]
    pub global_mock_enabled: bool,
    pub rules: Vec<ProxyRule>,
    #[serde(default)]
    pub local_responses: Vec<LocalMockResponse>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMockResponse {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default = "default_response_status")]
    pub status: u16,
    #[serde(default)]
    pub body: String,
}

fn default_response_status() -> u16 {
    200
}

fn default_global_mock_enabled() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApifoxConnection {
    pub mode: ApifoxMode,
    pub project_id: String,
    pub local_openapi_url: String,
    pub mock_prefix: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub mock_token: String,
}

impl Default for ApifoxConnection {
    fn default() -> Self {
        Self {
            mode: ApifoxMode::Online,
            project_id: String::new(),
            local_openapi_url: String::new(),
            mock_prefix: String::new(),
            access_token: String::new(),
            mock_token: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ApifoxMode {
    Online,
    Local,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRule {
    pub id: String,
    pub source: RuleSource,
    pub source_operation_id: String,
    #[serde(default)]
    pub apifox_web_url: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub match_mode: MatchMode,
    pub target: String,
    pub enabled: bool,
    pub tags: Vec<String>,
    pub priority: i32,
    #[serde(default)]
    pub local_response_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RuleSource {
    Apifox,
    Custom,
    Imported,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    Exact,
    Contains,
    Regex,
    Template,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProxyStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateStatus {
    pub generated: bool,
    pub trusted: bool,
    pub fingerprint: String,
    pub certificate_path: String,
}

impl Default for CertificateStatus {
    fn default() -> Self {
        Self {
            generated: false,
            trusted: false,
            fingerprint: String::new(),
            certificate_path: String::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub created_at: String,
    pub method: String,
    pub source: String,
    pub destination: String,
    pub rule_id: String,
    pub rule_name: String,
    pub tag: String,
    pub status: String,
    pub stage: String,
    pub response_code: Option<u16>,
    pub duration: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockResponsePreview {
    pub source: String,
    pub request_url: String,
    pub status: u16,
    pub status_text: String,
    pub duration: u64,
    pub content_type: String,
    pub body: String,
    pub truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub source_hosts: Vec<String>,
    pub path_prefix: String,
    pub port: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetExportInput {
    pub profile_id: String,
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub include_credentials: bool,
    pub exported_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetCreateInput {
    pub name: String,
    pub source_hosts: Vec<String>,
    pub path_prefix: String,
    pub port: u16,
    pub apifox: ProjectPresetApifox,
    #[serde(default)]
    pub credentials: ProjectPresetCredentials,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetPreview {
    pub metadata: ProjectPresetMetadata,
    pub project: ProjectPresetProject,
    pub credentials_included: bool,
    pub credentials: ProjectPresetCredentials,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetMetadata {
    pub name: String,
    pub description: String,
    pub exported_at: String,
    pub exported_by_app_version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetProject {
    pub suggested_name: String,
    pub source_hosts: Vec<String>,
    pub path_prefix: String,
    pub suggested_port: u16,
    pub apifox: ProjectPresetApifox,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetApifox {
    pub mode: ApifoxMode,
    pub project_id: String,
    pub mock_prefix: String,
    #[serde(default)]
    pub selected_tags: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPresetCredentials {
    #[serde(default)]
    pub included: bool,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub mock_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApifoxRequest {
    pub profile_id: String,
    pub mode: ApifoxMode,
    pub project_id: String,
    pub local_openapi_url: String,
    pub mock_prefix: String,
    pub access_token: Option<String>,
    pub mock_token: Option<String>,
    #[serde(default)]
    pub selected_tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApifoxPreview {
    pub available_tags: Vec<String>,
    pub operation_count: usize,
    pub selected_operation_count: usize,
    pub added_count: usize,
    pub updated_count: usize,
    pub removed_count: usize,
    pub retained_count: usize,
    pub interfaces: Vec<InterfacePreview>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfacePreview {
    pub id: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOperationInput {
    pub profile_id: String,
    pub url: String,
    pub method: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResolution {
    pub match_count: usize,
    pub interface: Option<ResolvedInterface>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedInterface {
    pub name: String,
    pub method: String,
    pub path: String,
    pub match_mode: MatchMode,
    pub target: String,
    pub tags: Vec<String>,
    pub apifox_web_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub match_mode: MatchMode,
    pub target: String,
    pub enabled: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    pub priority: i32,
    #[serde(default)]
    pub apifox_web_url: String,
    #[serde(default)]
    pub local_response_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMockResponseInput {
    pub id: Option<String>,
    pub profile_id: String,
    pub name: String,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default = "default_response_status")]
    pub status: u16,
    #[serde(default)]
    pub body: String,
}

#[cfg(test)]
mod tests {
    use super::{ApifoxConnection, ProjectProfile};

    #[test]
    fn persists_tokens_with_project_configuration() {
        let mut connection = ApifoxConnection::default();
        connection.access_token = "access-token".to_string();
        connection.mock_token = "mock-token".to_string();

        let serialized = serde_json::to_string(&connection).expect("connection should serialize");
        let restored: ApifoxConnection =
            serde_json::from_str(&serialized).expect("connection should deserialize");

        assert_eq!(restored.access_token, "access-token");
        assert_eq!(restored.mock_token, "mock-token");
    }

    #[test]
    fn existing_profile_without_global_switch_remains_enabled() {
        let profile = ProjectProfile {
            id: "profile".to_string(),
            name: "Profile".to_string(),
            source_hosts: vec!["api.example.test".to_string()],
            path_prefix: String::new(),
            port: 8899,
            apifox: ApifoxConnection::default(),
            synced_tags: Vec::new(),
            active_tags: Vec::new(),
            global_mock_enabled: false,
            rules: Vec::new(),
            local_responses: Vec::new(),
        };
        let mut serialized = serde_json::to_value(profile).expect("profile should serialize");
        serialized
            .as_object_mut()
            .expect("profile should be an object")
            .remove("globalMockEnabled");

        let migrated: ProjectProfile =
            serde_json::from_value(serialized).expect("legacy profile should deserialize");

        assert!(migrated.global_mock_enabled);
    }
}
