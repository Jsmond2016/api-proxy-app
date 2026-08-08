use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use crate::model::ProxyRule;

#[derive(Deserialize)]
struct OpenApiDocument {
    paths: BTreeMap<String, BTreeMap<String, Value>>,
}

#[derive(Deserialize)]
struct OpenApiOperation {
    summary: Option<String>,
    tags: Option<Vec<String>>,
}

pub struct ImportedOperation {
    pub method: String,
    pub name: String,
    pub path: String,
    pub tag: String,
}

pub fn parse_operations(
    content: &str,
    selected_tags: &[String],
) -> Result<Vec<ImportedOperation>, String> {
    let document = serde_json::from_str::<OpenApiDocument>(content)
        .map_err(|error| format!("OpenAPI JSON is invalid: {error}"))?;
    let mut operations = Vec::new();

    for (path, methods) in document.paths {
        for (method, operation_value) in methods {
            let normalized_method = method.to_uppercase();

            if !is_http_method(&normalized_method) {
                continue;
            }

            let operation = serde_json::from_value::<OpenApiOperation>(operation_value)
                .map_err(|error| format!("OpenAPI operation is invalid: {error}"))?;

            let tags = operation.tags.unwrap_or_default();

            if !matches_selected_tag(&tags, selected_tags) {
                continue;
            }

            let tag = primary_tag(tags);
            let name = operation
                .summary
                .unwrap_or_else(|| format!("{normalized_method} {path}"));

            operations.push(ImportedOperation {
                method: normalized_method,
                name,
                path: path.clone(),
                tag,
            });
        }
    }

    if operations.is_empty() {
        return Err("No OpenAPI operations matched the selected tags".to_string());
    }

    Ok(operations)
}

pub fn build_rules(operations: Vec<ImportedOperation>, mock_prefix: &str) -> Vec<ProxyRule> {
    operations
        .into_iter()
        .enumerate()
        .map(|(index, operation)| ProxyRule {
            id: format!("openapi-{}-{}", operation.method.to_lowercase(), index + 1),
            name: operation.name,
            method: operation.method,
            path: operation.path.clone(),
            match_mode: "exact".to_string(),
            target: build_mock_target(mock_prefix, &operation.path),
            enabled: true,
            tag: operation.tag,
        })
        .collect()
}

fn is_http_method(method: &str) -> bool {
    matches!(
        method,
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
    )
}

fn matches_selected_tag(operation_tags: &[String], selected_tags: &[String]) -> bool {
    if selected_tags.is_empty() {
        return true;
    }

    operation_tags
        .iter()
        .any(|tag| selected_tags.iter().any(|selected| selected == tag))
}

fn primary_tag(tags: Vec<String>) -> String {
    if let Some(tag) = tags.first() {
        return tag.clone();
    }

    "未分组".to_string()
}

fn build_mock_target(mock_prefix: &str, path: &str) -> String {
    let prefix = mock_prefix.trim_end_matches('/');

    if path.starts_with('/') {
        return format!("{prefix}{path}");
    }

    format!("{prefix}/{path}")
}

#[cfg(test)]
mod tests {
    use super::{build_rules, parse_operations};

    const FIXTURE: &str = r#"
    {
      "openapi": "3.0.0",
      "paths": {
        "/v1/products": {
          "get": { "summary": "商品列表", "tags": ["商品"] },
          "parameters": []
        },
        "/v1/orders": {
          "post": { "tags": ["订单"] }
        }
      }
    }
    "#;

    #[test]
    fn filters_operations_by_tag() {
        let tags = vec!["商品".to_string()];
        let operations = parse_operations(FIXTURE, &tags).expect("fixture should parse");

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].method, "GET");
        assert_eq!(operations[0].name, "商品列表");
    }

    #[test]
    fn creates_mock_targets_from_openapi_paths() {
        let operations = parse_operations(FIXTURE, &[]).expect("fixture should parse");
        let rules = build_rules(operations, "https://m1.apifoxmock.com/m1/project/");
        let order_rule = rules
            .iter()
            .find(|rule| rule.path == "/v1/orders")
            .expect("order rule should be present");

        assert_eq!(rules.len(), 2);
        assert_eq!(
            order_rule.target,
            "https://m1.apifoxmock.com/m1/project/v1/orders"
        );
        assert_eq!(order_rule.name, "POST /v1/orders");
    }
}
