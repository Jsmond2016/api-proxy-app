use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use hudsucker::rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
};
use hudsucker::rustls::pki_types::{pem::PemObject, CertificateDer};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use crate::model::{
    ApifoxConnection, ApifoxMode, CertificateStatus, DesktopSnapshot, MatchMode, ProjectProfile,
    ProxyRule, ProxyStatus, RuleSource, CURRENT_SCHEMA_VERSION,
};

pub struct AppState {
    pub snapshot: Arc<Mutex<DesktopSnapshot>>,
    pub proxy_runtime: Arc<Mutex<Option<ProxyRuntime>>>,
    certificate_directory: PathBuf,
    storage_path: PathBuf,
}

pub struct ProxyRuntime {
    pub shutdown: oneshot::Sender<()>,
    pub profile_id: String,
    pub port: u16,
    pub mock_token: Arc<Mutex<Option<String>>>,
}

impl ProxyRuntime {
    pub fn update_mock_token(&self, profile_id: &str, token: &str) -> Result<bool, String> {
        if self.profile_id != profile_id {
            return Ok(false);
        }
        let mut current = self
            .mock_token
            .lock()
            .map_err(|_| "proxy credential state is unavailable".to_string())?;
        *current = Some(token.to_string());
        Ok(true)
    }
}

pub struct CertificateMaterial {
    pub certificate_pem: String,
    pub private_key_pem: String,
    pub fingerprint: String,
    pub certificate_path: PathBuf,
}

impl AppState {
    pub fn load(data_directory: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&data_directory)?;
        let storage_path = data_directory.join("desktop-state.json");
        let certificate_directory = data_directory.join("certificates");
        let mut snapshot = load_snapshot(&storage_path);
        snapshot.schema_version = CURRENT_SCHEMA_VERSION;
        snapshot.proxy_status = ProxyStatus::Stopped;
        snapshot.logs.clear();
        for profile in &mut snapshot.profiles {
            profile.global_mock_enabled = false;
        }
        snapshot.certificate = certificate_status(&certificate_directory);

        let state = Self {
            snapshot: Arc::new(Mutex::new(snapshot)),
            proxy_runtime: Arc::new(Mutex::new(None)),
            certificate_directory,
            storage_path,
        };
        let snapshot = state
            .snapshot
            .lock()
            .map_err(|_| "desktop state is unavailable")?;
        state.persist(&snapshot)?;
        drop(snapshot);
        Ok(state)
    }

    pub fn persist(&self, snapshot: &DesktopSnapshot) -> Result<(), String> {
        let mut persisted = snapshot.clone();
        persisted.schema_version = CURRENT_SCHEMA_VERSION;
        persisted.proxy_status = ProxyStatus::Stopped;
        persisted.logs.clear();
        let serialized = serde_json::to_vec_pretty(&persisted)
            .map_err(|error| format!("failed to serialize desktop state: {error}"))?;
        let temporary_path = self.storage_path.with_extension("json.tmp");
        let backup_path = self.storage_path.with_extension("json.bak");

        fs::write(&temporary_path, serialized)
            .map_err(|error| format!("failed to write desktop state: {error}"))?;
        if self.storage_path.exists() {
            let _ = fs::copy(&self.storage_path, &backup_path);
        }
        fs::rename(&temporary_path, &self.storage_path)
            .map_err(|error| format!("failed to finalize desktop state: {error}"))?;
        Ok(())
    }

    pub fn update_runtime_mock_token(&self, profile_id: &str, token: &str) -> Result<bool, String> {
        let runtime = self
            .proxy_runtime
            .lock()
            .map_err(|_| "proxy runtime is unavailable".to_string())?;
        let Some(runtime) = runtime.as_ref() else {
            return Ok(false);
        };
        runtime.update_mock_token(profile_id, token)
    }

    pub fn certificate_material(&self) -> Result<CertificateMaterial, String> {
        fs::create_dir_all(&self.certificate_directory)
            .map_err(|error| format!("failed to create certificate directory: {error}"))?;
        let certificate_path = self.certificate_path();
        let key_path = self.certificate_key_path();

        if certificate_path.exists() && key_path.exists() {
            secure_private_key(&key_path)?;
            return read_certificate_material(certificate_path, key_path);
        }

        let material = create_certificate_material(certificate_path.clone())?;
        fs::write(&certificate_path, &material.certificate_pem)
            .map_err(|error| format!("failed to write certificate: {error}"))?;
        write_private_key(&key_path, &material.private_key_pem)?;
        Ok(material)
    }

    pub fn certificate_path(&self) -> PathBuf {
        self.certificate_directory.join("apifox-proxy-ca.pem")
    }

    pub fn certificate_key_path(&self) -> PathBuf {
        self.certificate_directory.join("apifox-proxy-ca-key.pem")
    }
}

fn write_private_key(path: &Path, content: &str) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| format!("failed to create certificate key: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("failed to write certificate key: {error}"))?;
    secure_private_key(path)
}

fn secure_private_key(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("failed to secure certificate key: {error}"))?;
    }
    Ok(())
}

fn create_certificate_material(certificate_path: PathBuf) -> Result<CertificateMaterial, String> {
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::CrlSign,
    ];
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Apifox Proxy");
    params
        .distinguished_name
        .push(DnType::CommonName, "Apifox Proxy Local CA");

    let key_pair =
        KeyPair::generate().map_err(|error| format!("failed to create CA key: {error}"))?;
    let certificate = params
        .self_signed(&key_pair)
        .map_err(|error| format!("failed to create CA certificate: {error}"))?;
    let certificate_pem = certificate.pem();
    let private_key_pem = key_pair.serialize_pem();
    let fingerprint = calculate_fingerprint(certificate.der().as_ref());

    Ok(CertificateMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
        certificate_path,
    })
}

fn read_certificate_material(
    certificate_path: PathBuf,
    key_path: PathBuf,
) -> Result<CertificateMaterial, String> {
    let certificate_pem = fs::read_to_string(&certificate_path)
        .map_err(|error| format!("failed to read certificate: {error}"))?;
    let private_key_pem = fs::read_to_string(key_path)
        .map_err(|error| format!("failed to read certificate key: {error}"))?;
    let fingerprint = fingerprint_from_pem(&certificate_pem)?;

    Ok(CertificateMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
        certificate_path,
    })
}

fn calculate_fingerprint(certificate: &[u8]) -> String {
    let digest = Sha256::digest(certificate);
    digest
        .iter()
        .map(|value| format!("{value:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn fingerprint_from_pem(certificate: &str) -> Result<String, String> {
    let der = CertificateDer::from_pem_slice(certificate.as_bytes())
        .map_err(|error| format!("failed to parse CA certificate: {error}"))?;
    Ok(calculate_fingerprint(der.as_ref()))
}

fn certificate_status(directory: &Path) -> CertificateStatus {
    let certificate_path = directory.join("apifox-proxy-ca.pem");
    if !certificate_path.exists() {
        return CertificateStatus::default();
    }
    let content = fs::read_to_string(&certificate_path).unwrap_or_default();
    CertificateStatus {
        generated: true,
        trusted: false,
        fingerprint: fingerprint_from_pem(&content).unwrap_or_default(),
        certificate_path: certificate_path.to_string_lossy().to_string(),
    }
}

fn load_snapshot(storage_path: &Path) -> DesktopSnapshot {
    let Ok(serialized) = fs::read_to_string(storage_path) else {
        return DesktopSnapshot::default();
    };
    if let Ok(snapshot) = serde_json::from_str::<DesktopSnapshot>(&serialized) {
        return normalize_snapshot(snapshot);
    }
    migrate_legacy_snapshot(&serialized).unwrap_or_default()
}

fn normalize_snapshot(mut snapshot: DesktopSnapshot) -> DesktopSnapshot {
    snapshot.schema_version = CURRENT_SCHEMA_VERSION;
    if let Some(active_id) = snapshot.active_profile_id.as_ref() {
        if !snapshot
            .profiles
            .iter()
            .any(|profile| &profile.id == active_id)
        {
            snapshot.active_profile_id =
                snapshot.profiles.first().map(|profile| profile.id.clone());
        }
    }
    snapshot
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySnapshot {
    profiles: Vec<LegacyProfile>,
    active_profile_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyProfile {
    id: String,
    name: String,
    domain: String,
    port: u16,
    apifox: LegacyApifox,
    rules: Vec<LegacyRule>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyApifox {
    mode: String,
    source: String,
    mock_prefix: String,
    selected_tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRule {
    id: String,
    name: String,
    method: String,
    path: String,
    match_mode: String,
    target: String,
    enabled: bool,
    tag: String,
}

fn migrate_legacy_snapshot(serialized: &str) -> Option<DesktopSnapshot> {
    let legacy = serde_json::from_str::<LegacySnapshot>(serialized).ok()?;
    if is_untouched_demo(&legacy) {
        return Some(DesktopSnapshot::default());
    }
    let profiles = legacy
        .profiles
        .into_iter()
        .map(migrate_legacy_profile)
        .collect::<Vec<_>>();
    let active_profile_id = profiles
        .iter()
        .find(|profile| profile.id == legacy.active_profile_id)
        .map(|profile| profile.id.clone())
        .or_else(|| profiles.first().map(|profile| profile.id.clone()));
    Some(DesktopSnapshot {
        schema_version: CURRENT_SCHEMA_VERSION,
        profiles,
        active_profile_id,
        ..DesktopSnapshot::default()
    })
}

fn is_untouched_demo(snapshot: &LegacySnapshot) -> bool {
    snapshot.profiles.iter().all(|profile| {
        let known_id = profile.id == "wx-retail" || profile.id == "wx-member";
        let known_source = profile.apifox.source == "Project #981245"
            || profile.apifox.source == "http://127.0.0.1:4523/export/openapi.json";
        known_id && known_source
    })
}

fn migrate_legacy_profile(profile: LegacyProfile) -> ProjectProfile {
    let mode = if profile.apifox.mode == "local" {
        ApifoxMode::Local
    } else {
        ApifoxMode::Online
    };
    let (project_id, local_openapi_url) = match mode {
        ApifoxMode::Online => (profile.apifox.source, String::new()),
        ApifoxMode::Local => (String::new(), profile.apifox.source),
    };
    let rules = profile.rules.into_iter().map(migrate_legacy_rule).collect();
    ProjectProfile {
        id: profile.id,
        name: profile.name,
        source_hosts: vec![profile.domain],
        path_prefix: String::new(),
        port: profile.port,
        apifox: ApifoxConnection {
            mode,
            project_id,
            local_openapi_url,
            mock_prefix: profile.apifox.mock_prefix,
            ..ApifoxConnection::default()
        },
        synced_tags: profile.apifox.selected_tags.clone(),
        active_tags: profile.apifox.selected_tags,
        global_mock_enabled: true,
        rules,
    }
}

fn migrate_legacy_rule(rule: LegacyRule) -> ProxyRule {
    let match_mode = match rule.match_mode.as_str() {
        "contains" => MatchMode::Contains,
        "regex" => MatchMode::Regex,
        _ => MatchMode::Exact,
    };
    ProxyRule {
        id: rule.id,
        source: RuleSource::Imported,
        source_operation_id: String::new(),
        apifox_web_url: String::new(),
        name: rule.name,
        method: rule.method,
        path: rule.path,
        match_mode,
        target: rule.target,
        custom_response_body: String::new(),
        enabled: rule.enabled,
        tags: vec![rule.tag],
        priority: 100,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{AppState, DesktopSnapshot, ProxyRuntime};
    use crate::model::{ApifoxConnection, ProjectProfile};
    use tokio::sync::oneshot;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("{name}-{timestamp}"))
    }

    #[test]
    fn starts_without_demo_profiles() {
        let directory = temporary_directory("apifox-proxy-empty");
        let state = AppState::load(directory.clone()).expect("state should initialize");
        let snapshot = state.snapshot.lock().expect("state should unlock");
        assert!(snapshot.profiles.is_empty());
        assert!(snapshot.logs.is_empty());
        drop(snapshot);
        fs::remove_dir_all(directory).expect("temporary state should be removed");
    }

    #[test]
    fn persists_and_normalizes_runtime_state() {
        let directory = temporary_directory("apifox-proxy-state");
        {
            let state = AppState::load(directory.clone()).expect("state should initialize");
            let snapshot = DesktopSnapshot::default();
            state.persist(&snapshot).expect("state should persist");
        }
        let reloaded = AppState::load(directory.clone()).expect("state should reload");
        let snapshot = reloaded.snapshot.lock().expect("state should unlock");
        assert!(snapshot.profiles.is_empty());
        assert!(snapshot.logs.is_empty());
        drop(snapshot);
        fs::remove_dir_all(directory).expect("temporary state should be removed");
    }

    #[test]
    fn application_load_disables_mock_for_safe_passthrough_start() {
        let directory = temporary_directory("apifox-proxy-safe-start");
        {
            let state = AppState::load(directory.clone()).expect("state should initialize");
            let mut snapshot = DesktopSnapshot::default();
            snapshot.active_profile_id = Some("profile".to_string());
            snapshot.profiles.push(ProjectProfile {
                id: "profile".to_string(),
                name: "Profile".to_string(),
                source_hosts: vec!["api.example.test".to_string()],
                path_prefix: String::new(),
                port: 8899,
                apifox: ApifoxConnection::default(),
                synced_tags: vec!["tag".to_string()],
                active_tags: vec!["tag".to_string()],
                global_mock_enabled: true,
                rules: Vec::new(),
            });
            state.persist(&snapshot).expect("state should persist");
        }
        let reloaded = AppState::load(directory.clone()).expect("state should reload");
        let snapshot = reloaded.snapshot.lock().expect("state should unlock");
        assert!(!snapshot.profiles[0].global_mock_enabled);
        drop(snapshot);
        fs::remove_dir_all(directory).expect("temporary state should be removed");
    }

    #[test]
    fn updates_mock_token_for_running_profile_only() {
        let directory = temporary_directory("apifox-proxy-runtime-token");
        let state = AppState::load(directory.clone()).expect("state should initialize");
        let (shutdown, _receiver) = oneshot::channel();
        let mock_token = Arc::new(Mutex::new(None));
        *state.proxy_runtime.lock().expect("runtime should unlock") = Some(ProxyRuntime {
            shutdown,
            profile_id: "profile-a".to_string(),
            port: 8899,
            mock_token: Arc::clone(&mock_token),
        });

        assert!(!state
            .update_runtime_mock_token("profile-b", "wrong-token")
            .expect("other profile update should be ignored"));
        assert!(state
            .update_runtime_mock_token("profile-a", "latest-token")
            .expect("active profile update should succeed"));
        assert_eq!(
            mock_token.lock().expect("token should unlock").as_deref(),
            Some("latest-token")
        );

        fs::remove_dir_all(directory).expect("temporary state should be removed");
    }
}
