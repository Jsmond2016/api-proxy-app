use crate::model::ProfileInput;

pub fn validate_input(input: &ProfileInput) -> Result<(String, Vec<String>, String), String> {
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

pub fn normalize_host(value: &str) -> Result<String, String> {
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
