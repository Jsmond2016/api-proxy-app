use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::model::{
    ApifoxConnection, ProfileInput, ProjectPresetApifox, ProjectPresetCredentials,
    ProjectPresetExportInput, ProjectPresetMetadata, ProjectPresetPreview, ProjectPresetProject,
    ProjectProfile,
};
use crate::profile::validate_input;

const PRESET_KIND: &str = "apifox-proxy-project-preset";
const PRESET_FORMAT_VERSION: u32 = 1;
const MAX_PRESET_BYTES: u64 = 256 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectPresetFile {
    kind: String,
    format_version: u32,
    metadata: ProjectPresetMetadata,
    project: ProjectPresetProject,
    #[serde(default)]
    credentials: ProjectPresetCredentials,
}

pub fn export_preset(
    profile: &ProjectProfile,
    input: &ProjectPresetExportInput,
    app_version: &str,
) -> Result<(), String> {
    let name = required_text(&input.name, "预设名称不能为空")?;
    let exported_at = required_text(&input.exported_at, "预设缺少导出时间")?;
    let credentials = export_credentials(profile, input.include_credentials);
    let preset = ProjectPresetFile {
        kind: PRESET_KIND.to_string(),
        format_version: PRESET_FORMAT_VERSION,
        metadata: ProjectPresetMetadata {
            name: name.to_string(),
            description: input.description.trim().to_string(),
            exported_at: exported_at.to_string(),
            exported_by_app_version: app_version.to_string(),
        },
        project: ProjectPresetProject {
            suggested_name: profile.name.clone(),
            source_hosts: profile.source_hosts.clone(),
            path_prefix: profile.path_prefix.clone(),
            suggested_port: profile.port,
            apifox: ProjectPresetApifox {
                mode: crate::model::ApifoxMode::Online,
                project_id: profile.apifox.project_id.clone(),
                mock_prefix: profile.apifox.mock_prefix.clone(),
                selected_tags: profile.synced_tags.clone(),
            },
        },
        credentials,
    };
    let serialized =
        serde_json::to_vec_pretty(&preset).map_err(|error| format!("无法生成项目预设：{error}"))?;
    fs::write(Path::new(input.path.trim()), serialized)
        .map_err(|error| format!("无法导出项目预设：{error}"))
}

pub fn read_preset(path: &str) -> Result<ProjectPresetPreview, String> {
    let path = Path::new(path.trim());
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取项目预设：{error}"))?;
    if metadata.len() > MAX_PRESET_BYTES {
        return Err("项目预设文件不能超过 256 KB".to_string());
    }
    let content = fs::read_to_string(path).map_err(|error| format!("无法读取项目预设：{error}"))?;
    let preset: ProjectPresetFile = serde_json::from_str(&content)
        .map_err(|_| "不是有效的 Apifox Proxy 项目预设文件".to_string())?;
    validate_file(&preset)?;
    Ok(ProjectPresetPreview {
        credentials_included: preset.credentials.included,
        metadata: preset.metadata,
        project: preset.project,
        credentials: preset.credentials,
    })
}

pub fn connection_from_preset(
    apifox: ProjectPresetApifox,
    credentials: ProjectPresetCredentials,
) -> ApifoxConnection {
    ApifoxConnection {
        mode: apifox.mode,
        project_id: apifox.project_id.trim().to_string(),
        local_openapi_url: String::new(),
        mock_prefix: apifox.mock_prefix.trim().to_string(),
        access_token: credentials.access_token.trim().to_string(),
        mock_token: credentials.mock_token.trim().to_string(),
    }
}

fn export_credentials(profile: &ProjectProfile, included: bool) -> ProjectPresetCredentials {
    if !included {
        return ProjectPresetCredentials::default();
    }
    ProjectPresetCredentials {
        included: true,
        access_token: profile.apifox.access_token.clone(),
        mock_token: profile.apifox.mock_token.clone(),
    }
}

fn validate_file(preset: &ProjectPresetFile) -> Result<(), String> {
    if preset.kind != PRESET_KIND {
        return Err("不是 Apifox Proxy 项目预设文件".to_string());
    }
    if preset.format_version != PRESET_FORMAT_VERSION {
        return Err("当前应用不支持该项目预设版本，请升级应用后重试".to_string());
    }
    required_text(&preset.metadata.name, "项目预设名称不能为空")?;
    required_text(&preset.project.suggested_name, "预设缺少建议项目名称")?;
    if preset.project.source_hosts.is_empty() {
        return Err("预设至少需要一个源域名".to_string());
    }
    if preset.project.suggested_port == 0 {
        return Err("预设中的本地代理端口无效".to_string());
    }
    validate_input(&ProfileInput {
        id: None,
        name: preset.project.suggested_name.clone(),
        source_hosts: preset.project.source_hosts.clone(),
        path_prefix: preset.project.path_prefix.clone(),
        port: preset.project.suggested_port,
    })?;
    required_text(&preset.metadata.exported_at, "预设缺少导出时间")?;
    if !preset.credentials.included
        && (!preset.credentials.access_token.is_empty()
            || !preset.credentials.mock_token.is_empty())
    {
        return Err("预设凭据标记无效".to_string());
    }
    Ok(())
}

fn required_text<'a>(value: &'a str, message: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(message.to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{export_preset, read_preset};
    use crate::model::{ApifoxConnection, ApifoxMode, ProjectPresetExportInput, ProjectProfile};

    fn profile() -> ProjectProfile {
        ProjectProfile {
            id: "profile-1".to_string(),
            name: "会员测试".to_string(),
            source_hosts: vec!["api.example.test".to_string()],
            path_prefix: "/api".to_string(),
            port: 8899,
            apifox: ApifoxConnection {
                mode: ApifoxMode::Online,
                project_id: "123".to_string(),
                local_openapi_url: String::new(),
                mock_prefix: "https://mock.example.test".to_string(),
                access_token: "access-token".to_string(),
                mock_token: "mock-token".to_string(),
            },
            synced_tags: vec!["会员".to_string()],
            active_tags: vec!["会员".to_string()],
            global_mock_enabled: true,
            rules: Vec::new(),
            local_responses: Vec::new(),
        }
    }

    #[test]
    fn exports_without_credentials_by_default() {
        let path = temp_preset_path("without-credentials");
        export_preset(
            &profile(),
            &ProjectPresetExportInput {
                profile_id: "profile-1".to_string(),
                path: path.to_string_lossy().to_string(),
                name: "测试预设".to_string(),
                description: String::new(),
                include_credentials: false,
                exported_at: "2026-09-10T09:00:00.000Z".to_string(),
            },
            "0.1.58",
        )
        .expect("export preset");
        let content = std::fs::read_to_string(path).expect("read preset");
        assert!(!content.contains("access-token"));
        assert!(!content.contains("mock-token"));
        let _ = std::fs::remove_file(temp_preset_path("without-credentials"));
    }

    #[test]
    fn reads_exported_preset_as_preview() {
        let path = temp_preset_path("with-credentials");
        export_preset(
            &profile(),
            &ProjectPresetExportInput {
                profile_id: "profile-1".to_string(),
                path: path.to_string_lossy().to_string(),
                name: "测试预设".to_string(),
                description: String::new(),
                include_credentials: true,
                exported_at: "2026-09-10T09:00:00.000Z".to_string(),
            },
            "0.1.58",
        )
        .expect("export preset");
        let preview = read_preset(&path.to_string_lossy()).expect("read preset");
        assert!(preview.credentials_included);
        assert_eq!(preview.project.apifox.selected_tags, ["会员"]);
        let _ = std::fs::remove_file(temp_preset_path("with-credentials"));
    }

    #[test]
    fn rejects_unknown_preset_version_without_creating_a_preview() {
        let path = temp_preset_path("unknown-version");
        std::fs::write(
            &path,
            r#"{"kind":"apifox-proxy-project-preset","formatVersion":2,"metadata":{"name":"测试","description":"","exportedAt":"2026-09-10T09:00:00.000Z","exportedByAppVersion":"0.1.58"},"project":{"suggestedName":"测试","sourceHosts":["api.example.test"],"pathPrefix":"","suggestedPort":8899,"apifox":{"mode":"online","projectId":"","mockPrefix":"","selectedTags":[]}},"credentials":{"included":false}}"#,
        )
        .expect("write preset");
        assert!(read_preset(&path.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(path);
    }

    fn temp_preset_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("apifox-proxy-{name}-{}.json", std::process::id()))
    }
}
