use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use hudsucker::rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
};
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use crate::model::{
    ApifoxConnection, CertificateStatus, DesktopSnapshot, ProjectProfile, ProxyRule, ProxyStatus,
    RequestLog,
};

pub struct AppState {
    pub snapshot: Arc<Mutex<DesktopSnapshot>>,
    pub proxy_runtime: Arc<Mutex<Option<ProxyRuntime>>>,
    certificate_directory: PathBuf,
    storage_path: PathBuf,
}

pub struct ProxyRuntime {
    pub shutdown: oneshot::Sender<()>,
}

pub struct CertificateMaterial {
    pub certificate_pem: String,
    pub private_key_pem: String,
    pub fingerprint: String,
}

impl AppState {
    pub fn load(data_directory: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&data_directory)?;
        let storage_path = data_directory.join("desktop-state.json");
        let certificate_directory = data_directory.join("certificates");
        let snapshot = load_snapshot(&storage_path);

        Ok(Self {
            snapshot: Arc::new(Mutex::new(snapshot)),
            proxy_runtime: Arc::new(Mutex::new(None)),
            certificate_directory,
            storage_path,
        })
    }

    pub fn persist(&self, snapshot: &DesktopSnapshot) -> Result<(), String> {
        let serialized = serde_json::to_vec_pretty(snapshot)
            .map_err(|error| format!("failed to serialize desktop state: {error}"))?;
        let temporary_path = self.storage_path.with_extension("json.tmp");

        fs::write(&temporary_path, serialized)
            .map_err(|error| format!("failed to write desktop state: {error}"))?;
        fs::rename(&temporary_path, &self.storage_path)
            .map_err(|error| format!("failed to finalize desktop state: {error}"))?;

        Ok(())
    }

    pub fn certificate_material(&self) -> Result<CertificateMaterial, String> {
        fs::create_dir_all(&self.certificate_directory)
            .map_err(|error| format!("failed to create certificate directory: {error}"))?;
        let certificate_path = self.certificate_directory.join("apifox-proxy-ca.pem");
        let key_path = self.certificate_directory.join("apifox-proxy-ca-key.pem");

        if certificate_path.exists() && key_path.exists() {
            return read_certificate_material(certificate_path, key_path);
        }

        let material = create_certificate_material()?;
        fs::write(&certificate_path, &material.certificate_pem)
            .map_err(|error| format!("failed to write certificate: {error}"))?;
        fs::write(&key_path, &material.private_key_pem)
            .map_err(|error| format!("failed to write certificate key: {error}"))?;

        Ok(material)
    }
}

fn create_certificate_material() -> Result<CertificateMaterial, String> {
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
    let fingerprint = calculate_fingerprint(certificate_pem.as_bytes());

    Ok(CertificateMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
    })
}

fn read_certificate_material(
    certificate_path: PathBuf,
    key_path: PathBuf,
) -> Result<CertificateMaterial, String> {
    let certificate_pem = fs::read_to_string(certificate_path)
        .map_err(|error| format!("failed to read certificate: {error}"))?;
    let private_key_pem = fs::read_to_string(key_path)
        .map_err(|error| format!("failed to read certificate key: {error}"))?;
    let fingerprint = calculate_fingerprint(certificate_pem.as_bytes());

    Ok(CertificateMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
    })
}

fn calculate_fingerprint(certificate: &[u8]) -> String {
    let digest = Sha256::digest(certificate);
    let chunks = digest.chunks(2);
    let mut values = Vec::new();

    for chunk in chunks {
        values.push(format!("{:02X}{:02X}", chunk[0], chunk[1]));
    }

    values.join(":")
}

fn load_snapshot(storage_path: &PathBuf) -> DesktopSnapshot {
    let content = fs::read_to_string(storage_path);

    if let Ok(serialized) = content {
        if let Ok(snapshot) = serde_json::from_str::<DesktopSnapshot>(&serialized) {
            return snapshot;
        }
    }

    default_snapshot()
}

fn default_snapshot() -> DesktopSnapshot {
    DesktopSnapshot {
        active_profile_id: "wx-retail".to_string(),
        proxy_status: ProxyStatus::Stopped,
        certificate: CertificateStatus {
            generated: false,
            trusted: false,
            fingerprint: "Not generated".to_string(),
        },
        profiles: vec![retail_profile(), member_profile()],
        logs: vec![
            request_log(
                "log-1",
                "10:42:16.310",
                "GET",
                "api.dev.acme.test/v1/products?page=1",
                "m1.apifoxmock.com/m1/981245-0-default/v1/products?page=1",
                "商品列表",
                "matched",
                200,
                184,
            ),
            request_log(
                "log-2",
                "10:41:58.905",
                "POST",
                "api.dev.acme.test/v1/orders",
                "m1.apifoxmock.com/m1/981245-0-default/v1/orders",
                "创建订单",
                "matched",
                201,
                267,
            ),
            request_log(
                "log-3",
                "10:40:11.440",
                "GET",
                "api.dev.acme.test/v1/notice",
                "api.dev.acme.test/v1/notice",
                "未命中",
                "passed",
                200,
                96,
            ),
        ],
    }
}

fn retail_profile() -> ProjectProfile {
    ProjectProfile {
        id: "wx-retail".to_string(),
        name: "零售小程序".to_string(),
        domain: "api.dev.acme.test".to_string(),
        port: 8899,
        apifox: ApifoxConnection {
            mode: "online".to_string(),
            source: "Project #981245".to_string(),
            mock_prefix: "https://m1.apifoxmock.com/m1/981245-0-default".to_string(),
            selected_tags: vec!["商品".to_string(), "订单".to_string()],
        },
        rules: vec![
            proxy_rule(
                "product-list",
                "商品列表",
                "GET",
                "/v1/products",
                "exact",
                "https://m1.apifoxmock.com/m1/981245-0-default/v1/products",
                true,
                "商品",
            ),
            proxy_rule(
                "order-create",
                "创建订单",
                "POST",
                "/v1/orders",
                "exact",
                "https://m1.apifoxmock.com/m1/981245-0-default/v1/orders",
                true,
                "订单",
            ),
            proxy_rule(
                "coupon-query",
                "优惠券查询",
                "GET",
                "/v1/coupons",
                "contains",
                "https://m1.apifoxmock.com/m1/981245-0-default/v1/coupons",
                false,
                "营销",
            ),
        ],
    }
}

fn member_profile() -> ProjectProfile {
    ProjectProfile {
        id: "wx-member".to_string(),
        name: "会员中心".to_string(),
        domain: "member.dev.acme.test".to_string(),
        port: 8899,
        apifox: ApifoxConnection {
            mode: "local".to_string(),
            source: "http://127.0.0.1:4523/export/openapi.json".to_string(),
            mock_prefix: "http://127.0.0.1:4523/m1/77215-0-default".to_string(),
            selected_tags: vec!["会员".to_string()],
        },
        rules: Vec::new(),
    }
}

fn proxy_rule(
    id: &str,
    name: &str,
    method: &str,
    path: &str,
    match_mode: &str,
    target: &str,
    enabled: bool,
    tag: &str,
) -> ProxyRule {
    ProxyRule {
        id: id.to_string(),
        name: name.to_string(),
        method: method.to_string(),
        path: path.to_string(),
        match_mode: match_mode.to_string(),
        target: target.to_string(),
        enabled,
        tag: tag.to_string(),
    }
}

fn request_log(
    id: &str,
    created_at: &str,
    method: &str,
    source: &str,
    destination: &str,
    rule_name: &str,
    status: &str,
    response_code: u16,
    duration: u16,
) -> RequestLog {
    RequestLog {
        id: id.to_string(),
        created_at: created_at.to_string(),
        method: method.to_string(),
        source: source.to_string(),
        destination: destination.to_string(),
        rule_name: rule_name.to_string(),
        status: status.to_string(),
        response_code,
        duration,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::AppState;

    #[test]
    fn persists_desktop_snapshot() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("apifox-proxy-state-{timestamp}"));

        {
            let state = AppState::load(directory.clone()).expect("state should initialize");
            let mut snapshot = state.snapshot.lock().expect("state should unlock");
            snapshot.active_profile_id = "wx-member".to_string();
            state.persist(&snapshot).expect("state should persist");
        }

        let reloaded = AppState::load(directory.clone()).expect("state should reload");
        let snapshot = reloaded
            .snapshot
            .lock()
            .expect("reloaded state should unlock");

        assert_eq!(snapshot.active_profile_id, "wx-member");
        drop(snapshot);
        fs::remove_dir_all(directory).expect("temporary state should be removed");
    }
}
