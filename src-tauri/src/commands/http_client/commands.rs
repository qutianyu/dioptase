use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
}

#[allow(dead_code)]
#[derive(Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn send_http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &url);

    for (key, value) in &headers {
        req = req.header(key.as_str(), value.as_str());
    }

    if !body.is_empty() {
        req = req.body(body);
    }

    let start = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| format!("Request error: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let resp_body = resp.text().await.map_err(|e| format!("Body error: {}", e))?;

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body: resp_body,
        time_ms: elapsed,
    })
}