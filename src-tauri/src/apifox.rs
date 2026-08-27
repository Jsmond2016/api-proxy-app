use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::model::{ApifoxMode, ApifoxRequest, MatchMode, ProxyRule, RuleSource};

const APIFOX_API_ROOT: &str = "https://api.apifox.com/v1/projects";
const APIFOX_API_VERSION: &str = "2024-03-28";

#[derive(Deserialize)]
struct OpenApiDocument {
    #[serde(default)]
    tags: Vec<OpenApiTag>,
    paths: BTreeMap<String, BTreeMap<String, Value>>,
}

#[derive(Deserialize)]
struct OpenApiTag {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenApiOperation {
    operation_id: Option<String>,
    summary: Option<String>,
    tags: Option<Vec<String>>,
    #[serde(flatten)]
    extensions: HashMap<String, Value>,
}

#[derive(Clone)]
pub struct ImportedOperation {
    pub source_id: String,
    pub api_id: String,
    pub apifox_web_url: String,
    pub method: String,
    pub name: String,
    pub path: String,
    pub tags: Vec<String>,
}

pub struct ParsedDocument {
    pub operations: Vec<ImportedOperation>,
    pub available_tags: Vec<String>,
}

pub async fn fetch_document(
    request: &ApifoxRequest,
    access_token: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create Apifox client: {error}"))?;
    let response = match request.mode {
        ApifoxMode::Online => {
            let project_id = request.project_id.trim();
            if project_id.is_empty() {
                return Err("Apifox project ID is required".to_string());
            }
            let token = access_token
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Apifox access token is required".to_string())?;
            let url = format!("{APIFOX_API_ROOT}/{project_id}/export-openapi?locale=zh-CN");
            client
                .post(url)
                .bearer_auth(token)
                .header("X-Apifox-Api-Version", APIFOX_API_VERSION)
                .json(&json!({
                    "scope": { "type": "ALL" },
                    "options": { "includeApifoxExtensionProperties": true },
                    "oasVersion": "3.1",
                    "exportFormat": "JSON"
                }))
                .send()
                .await
        }
        ApifoxMode::Local => {
            let url = request.local_openapi_url.trim();
            if url.is_empty() {
                return Err("Local OpenAPI URL is required".to_string());
            }
            client.get(url).send().await
        }
    }
    .map_err(|error| format!("Unable to fetch OpenAPI document: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("OpenAPI endpoint returned HTTP {status}"));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Unable to read OpenAPI response: {error}"))
}

pub fn parse_document(content: &str) -> Result<ParsedDocument, String> {
    let root = serde_json::from_str::<Value>(content)
        .map_err(|error| format!("OpenAPI JSON is invalid: {error}"))?;
    if root.get("openapi").is_none() && root.get("swagger").is_none() {
        return Err("Document is not OpenAPI or Swagger JSON".to_string());
    }
    let document = serde_json::from_value::<OpenApiDocument>(root)
        .map_err(|error| format!("OpenAPI paths are invalid: {error}"))?;
    let mut operations = Vec::new();
    let mut folder_tags = BTreeSet::new();
    let mut tags = document
        .tags
        .into_iter()
        .map(|tag| tag.name)
        .collect::<BTreeSet<_>>();

    for (path, methods) in document.paths {
        for (method, operation_value) in methods {
            let normalized_method = method.to_uppercase();
            if !is_http_method(&normalized_method) {
                continue;
            }
            let operation = serde_json::from_value::<OpenApiOperation>(operation_value)
                .map_err(|error| format!("OpenAPI operation is invalid: {error}"))?;
            if let Some(folder) = operation
                .extensions
                .get("x-apifox-folder")
                .and_then(Value::as_str)
            {
                collect_folder_tags(folder, &mut folder_tags);
            }
            let source_id = operation_source_id(&operation, &normalized_method, &path);
            let api_id = operation_api_id(&operation);
            let apifox_web_url = normalize_apifox_web_url(
                operation
                    .extensions
                    .get("x-run-in-apifox")
                    .and_then(Value::as_str),
            );
            let operation_tags = operation.tags.unwrap_or_default();
            tags.extend(operation_tags.iter().cloned());
            let name = operation
                .summary
                .unwrap_or_else(|| format!("{normalized_method} {path}"));
            operations.push(ImportedOperation {
                source_id,
                api_id,
                apifox_web_url,
                method: normalized_method,
                name,
                path: path.clone(),
                tags: operation_tags,
            });
        }
    }
    if operations.is_empty() {
        return Err("OpenAPI document does not contain supported operations".to_string());
    }
    tags.retain(|tag| !folder_tags.contains(tag));
    Ok(ParsedDocument {
        operations,
        available_tags: tags.into_iter().collect(),
    })
}

fn collect_folder_tags(folder: &str, tags: &mut BTreeSet<String>) {
    let mut prefix = String::new();
    for segment in folder.split('/').filter(|segment| !segment.is_empty()) {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(segment);
        tags.insert(prefix.clone());
    }
}

pub fn build_rules(
    operations: &[ImportedOperation],
    selected_tags: &[String],
    mock_prefix: &str,
    project_id: &str,
) -> Result<Vec<ProxyRule>, String> {
    let prefix = mock_prefix.trim();
    if prefix.is_empty() {
        return Err("Apifox Mock prefix is required".to_string());
    }
    url::Url::parse(prefix).map_err(|error| format!("Mock prefix is invalid: {error}"))?;
    let selected = selected_tags.iter().collect::<BTreeSet<_>>();
    let mut rules = Vec::new();

    for operation in operations {
        let matches =
            selected.is_empty() || operation.tags.iter().any(|tag| selected.contains(tag));
        if !matches {
            continue;
        }
        let match_mode = if operation.path.contains('{') {
            MatchMode::Template
        } else {
            MatchMode::Exact
        };
        rules.push(ProxyRule {
            id: format!("apifox-{}", operation.source_id),
            source: RuleSource::Apifox,
            source_operation_id: operation.source_id.clone(),
            apifox_web_url: operation_web_url(operation, project_id),
            name: operation.name.clone(),
            method: operation.method.clone(),
            path: operation.path.clone(),
            match_mode,
            target: build_mock_target(prefix, &operation.path)?,
            enabled: true,
            tags: operation.tags.clone(),
            priority: 100,
        });
    }
    if rules.is_empty() {
        return Err("No OpenAPI operations matched the selected tags".to_string());
    }
    Ok(rules)
}

pub fn replace_rules(existing: &[ProxyRule], incoming: Vec<ProxyRule>) -> Vec<ProxyRule> {
    let mut result = existing
        .iter()
        .filter(|rule| rule.source != RuleSource::Apifox)
        .cloned()
        .collect::<Vec<_>>();
    result.extend(incoming);
    result.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.name.cmp(&right.name))
    });
    result
}

pub fn apply_mock_token(rules: &mut [ProxyRule], mock_token: &str) -> Result<(), String> {
    for rule in rules {
        if rule.source != RuleSource::Apifox {
            continue;
        }
        rule.target = target_with_mock_token(&rule.target, mock_token)?;
    }
    Ok(())
}

fn operation_source_id(operation: &OpenApiOperation, method: &str, path: &str) -> String {
    if let Some(id) = operation.operation_id.as_deref() {
        if !id.trim().is_empty() {
            return stable_id(id);
        }
    }
    if let Some(run_url) = operation
        .extensions
        .get("x-run-in-apifox")
        .and_then(Value::as_str)
    {
        if let Some(id) = run_url.rsplit('/').next() {
            if !id.trim().is_empty() {
                return stable_id(id);
            }
        }
    }
    stable_id(&format!("{method}:{path}"))
}

fn operation_api_id(operation: &OpenApiOperation) -> String {
    if let Some(run_url) = operation
        .extensions
        .get("x-run-in-apifox")
        .and_then(Value::as_str)
    {
        if let Ok(parsed) = url::Url::parse(run_url.trim()) {
            if let Some(id) = parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .and_then(apifox_id_from_path_segment)
            {
                return id;
            }
        }
    }
    operation
        .operation_id
        .as_deref()
        .map(str::trim)
        .filter(|id| is_numeric_id(id))
        .unwrap_or_default()
        .to_string()
}

fn apifox_id_from_path_segment(segment: &str) -> Option<String> {
    let value = segment.strip_prefix("api-")?;
    let id = value.split('-').next()?;
    if is_numeric_id(id) {
        return Some(id.to_string());
    }
    None
}

fn normalize_apifox_web_url(value: Option<&str>) -> String {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return String::new();
    };
    let Ok(mut parsed) = url::Url::parse(value) else {
        return String::new();
    };
    if !matches!(parsed.scheme(), "http" | "https") || !is_apifox_host(parsed.host_str()) {
        return String::new();
    }
    let mut path = parsed.path().replace("/web/project/", "/project/");
    for suffix in ["-run", "-link"] {
        if path.ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
            break;
        }
    }
    parsed.set_path(&path);
    parsed.to_string().trim_end_matches('/').to_string()
}

fn operation_web_url(operation: &ImportedOperation, project_id: &str) -> String {
    if !operation.apifox_web_url.is_empty() {
        return operation.apifox_web_url.clone();
    }
    let project_id = project_id.trim();
    if !is_numeric_id(project_id) || !is_numeric_id(&operation.api_id) {
        return String::new();
    }
    format!(
        "https://app.apifox.com/project/{project_id}/apis/api-{}",
        operation.api_id
    )
}

fn is_numeric_id(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_apifox_host(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    host == "apifox.com" || host.ends_with(".apifox.com")
}

fn stable_id(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_http_method(method: &str) -> bool {
    matches!(
        method,
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
    )
}

fn build_mock_target(mock_prefix: &str, path: &str) -> Result<String, String> {
    let mut target =
        url::Url::parse(mock_prefix).map_err(|error| format!("Mock prefix is invalid: {error}"))?;
    let prefix_path = target.path().trim_end_matches('/');
    let operation_path = path.trim_start_matches('/');
    target.set_path(&format!("{prefix_path}/{operation_path}"));
    Ok(target.to_string())
}

fn target_with_mock_token(target: &str, mock_token: &str) -> Result<String, String> {
    let mut target =
        url::Url::parse(target).map_err(|error| format!("Mock target is invalid: {error}"))?;
    let query = target
        .query_pairs()
        .filter(|(key, _)| key != "apifoxToken")
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<Vec<_>>();
    target.set_query(None);
    if !query.is_empty() || !mock_token.is_empty() {
        let mut serializer = target.query_pairs_mut();
        for (key, value) in query {
            serializer.append_pair(&key, &value);
        }
        if !mock_token.is_empty() {
            serializer.append_pair("apifoxToken", mock_token);
        }
    }
    Ok(target.to_string())
}

#[cfg(test)]
mod tests {
    use super::{apply_mock_token, build_rules, parse_document, replace_rules};
    use crate::model::{MatchMode, RuleSource};

    const FIXTURE: &str = r#"
    {
      "openapi": "3.0.0",
      "tags": [{"name": "商品"}, {"name": "订单"}],
      "paths": {
        "/v1/products": {
          "get": {
            "operationId": "listProducts",
            "summary": "商品列表",
            "tags": ["商品"],
            "x-run-in-apifox": "https://apifox.com/web/project/123/apis/api-456-run"
          },
          "parameters": []
        },
        "/v1/orders/{id}": {
          "post": { "summary": "更新订单", "tags": ["订单"] }
        }
      }
    }
    "#;

    #[test]
    fn discovers_tags_and_builds_template_rules() {
        let document = parse_document(FIXTURE).expect("fixture should parse");
        assert_eq!(document.available_tags, vec!["商品", "订单"]);
        let rules = build_rules(
            &document.operations,
            &["订单".to_string()],
            "https://m1.apifoxmock.com/m1/project",
            "123",
        )
        .expect("rules should build");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].match_mode, MatchMode::Template);
        let target = url::Url::parse(&rules[0].target).expect("target should parse");
        assert_eq!(target.path(), "/m1/project/v1/orders/%7Bid%7D");
    }

    #[test]
    fn synchronized_rules_include_encoded_mock_token_after_the_interface_path() {
        let document = parse_document(FIXTURE).expect("fixture should parse");
        let mut rules = build_rules(
            &document.operations,
            &["订单".to_string()],
            "https://mock.example.test/base?environment=dev",
            "123",
        )
        .expect("rules should build");

        apply_mock_token(&mut rules, "mock token+value").expect("token should apply");

        let target = url::Url::parse(&rules[0].target).expect("target should be valid");
        assert_eq!(target.path(), "/base/v1/orders/%7Bid%7D");
        assert_eq!(
            target
                .query_pairs()
                .find(|(key, _)| key == "apifoxToken")
                .map(|(_, value)| value.to_string())
                .as_deref(),
            Some("mock token+value")
        );
        assert!(target
            .query_pairs()
            .any(|(key, value)| key == "environment" && value == "dev"));
    }

    #[test]
    fn refreshing_mock_token_updates_all_apifox_rules_only() {
        let document = parse_document(FIXTURE).expect("fixture should parse");
        let mut rules = build_rules(
            &document.operations,
            &[],
            "https://mock.example.test/base",
            "123",
        )
        .expect("rules should build");
        apply_mock_token(&mut rules, "old-token").expect("old token should apply");
        let mut custom = rules[0].clone();
        custom.id = "custom".to_string();
        custom.source = RuleSource::Custom;
        custom.target = "https://custom.example.test/response?fixed=1".to_string();
        rules.push(custom);

        apply_mock_token(&mut rules, "current-token").expect("current token should apply");

        for rule in rules
            .iter()
            .filter(|rule| rule.source == RuleSource::Apifox)
        {
            let target = url::Url::parse(&rule.target).expect("target should parse");
            let tokens = target
                .query_pairs()
                .filter(|(key, _)| key == "apifoxToken")
                .map(|(_, value)| value.to_string())
                .collect::<Vec<_>>();
            assert_eq!(tokens, vec!["current-token"]);
        }
        assert_eq!(
            rules
                .iter()
                .find(|rule| rule.source == RuleSource::Custom)
                .expect("custom rule should remain")
                .target,
            "https://custom.example.test/response?fixed=1"
        );
    }

    #[test]
    fn replace_discards_old_apifox_rules_and_preserves_custom_rules() {
        let document = parse_document(FIXTURE).expect("fixture should parse");
        let mut existing = build_rules(
            &document.operations,
            &["商品".to_string()],
            "https://old.example.test",
            "123",
        )
        .expect("existing rules should build");
        existing[0].enabled = false;
        let mut custom = existing[0].clone();
        custom.id = "custom-rule".to_string();
        custom.source = RuleSource::Custom;
        custom.source_operation_id.clear();
        custom.apifox_web_url.clear();
        existing.push(custom);
        let incoming = build_rules(
            &document.operations,
            &["订单".to_string()],
            "https://new.example.test",
            "123",
        )
        .expect("incoming rules should build");
        let replaced = replace_rules(&existing, incoming);
        assert_eq!(replaced.len(), 2);
        assert!(replaced
            .iter()
            .any(|rule| rule.source == RuleSource::Custom));
        let apifox = replaced
            .iter()
            .find(|rule| rule.source == RuleSource::Apifox)
            .expect("incoming Apifox rule should remain");
        assert!(apifox.enabled);
        assert!(apifox.tags.contains(&"订单".to_string()));
        assert!(!replaced.iter().any(|rule| {
            rule.source == RuleSource::Apifox && rule.tags.contains(&"商品".to_string())
        }));
    }

    #[test]
    fn normalizes_direct_apifox_web_link() {
        let document = parse_document(FIXTURE).expect("fixture should parse");
        let rules = build_rules(
            &document.operations,
            &["商品".to_string()],
            "https://mock.example.test",
            "123",
        )
        .expect("rules should build");
        assert_eq!(
            rules[0].apifox_web_url,
            "https://apifox.com/project/123/apis/api-456"
        );
    }

    #[test]
    fn builds_fallback_link_only_for_numeric_project_and_api_ids() {
        let document = parse_document(
            r#"{
              "openapi": "3.0.0",
              "paths": {
                "/numeric": {"get": {"operationId": "789"}},
                "/named": {"get": {"operationId": "getNamed"}}
              }
            }"#,
        )
        .expect("fixture should parse");
        let rules = build_rules(
            &document.operations,
            &[],
            "https://mock.example.test",
            "456",
        )
        .expect("rules should build");
        let numeric = rules.iter().find(|rule| rule.path == "/numeric").unwrap();
        let named = rules.iter().find(|rule| rule.path == "/named").unwrap();
        assert_eq!(
            numeric.apifox_web_url,
            "https://app.apifox.com/project/456/apis/api-789"
        );
        assert!(named.apifox_web_url.is_empty());
    }

    #[test]
    fn imports_standard_openapi_without_apifox_extensions() {
        let document = parse_document(
            r#"{
              "openapi": "3.0.0",
              "tags": [{"name": "订单"}],
              "paths": {
                "/orders/{id}": {
                  "get": {"summary": "订单详情", "tags": ["订单"]}
                }
              }
            }"#,
        )
        .expect("standard OpenAPI should parse");
        let rules = build_rules(
            &document.operations,
            &["订单".to_string()],
            "https://mock.example.test",
            "",
        )
        .expect("rules should build without Apifox extensions");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].match_mode, MatchMode::Template);
        assert!(!rules[0].source_operation_id.is_empty());
    }

    #[test]
    fn filters_apifox_folder_names_from_selectable_tags() {
        let document = parse_document(
            r#"{
              "openapi": "3.0.0",
              "tags": [
                {"name": "业务目录"},
                {"name": "业务目录/订单"},
                {"name": "迭代-42"}
              ],
              "paths": {
                "/orders": {
                  "get": {
                    "tags": ["迭代-42"],
                    "x-apifox-folder": "业务目录/订单"
                  }
                }
              }
            }"#,
        )
        .expect("Apifox OpenAPI should parse");
        assert_eq!(document.available_tags, vec!["迭代-42".to_string()]);
    }
}
