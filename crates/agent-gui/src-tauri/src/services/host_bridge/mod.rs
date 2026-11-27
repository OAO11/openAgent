//! Loopback host bridge: lets K-brain run desktop-only tools (`ReadTerminal`,
//! `TunnelManager`) whose side effects live in this process.
//!
//! K-brain owns the tool schema, permissions and history; this server only
//! performs the side effect through the same Rust functions the Tauri commands
//! use. It lives in Rust, so it keeps working while the webview reloads.
//!
//! Security:
//! - binds `127.0.0.1:0` only, never a wildcard address;
//! - a fresh 32-byte bearer token from the OS CSPRNG per app launch, compared in
//!   constant time, never logged or persisted (it is only sent to the local
//!   K-brain in the registration body);
//! - requests whose `Host` is not the loopback listener (DNS rebinding) or that
//!   carry an `Origin`/`Sec-Fetch-*` header (browsers) are refused;
//! - request bodies are capped at [`MAX_BODY_BYTES`].

pub mod registration;
#[cfg(test)]
mod tests;

use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::{to_bytes, Body},
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime::terminal::{TerminalReadTailResponse, TerminalSessionRegistry};

pub use registration::HostBridgeRegistrar;
pub(crate) use registration::{emit_status_listener, spawn_follower};

/// Identifies this host in the K-brain registration.
pub const HOST_BRIDGE_HOST: &str = "liveagent-desktop";
pub const READ_TERMINAL_TOOL: &str = "ReadTerminal";
pub(crate) const MAX_BODY_BYTES: usize = 64 * 1024;
const TOKEN_BYTES: usize = 32;

/// Where K-brain reaches the bridge. `Debug` never prints the token.
#[derive(Clone)]
pub struct HostBridgeEndpoint {
    url: String,
    port: u16,
    token: Arc<str>,
}

impl std::fmt::Debug for HostBridgeEndpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostBridgeEndpoint")
            .field("url", &self.url)
            .field("token", &"<redacted>")
            .finish()
    }
}

impl HostBridgeEndpoint {
    pub fn url(&self) -> &str {
        &self.url
    }

    pub(crate) fn token(&self) -> &str {
        &self.token
    }
}

/// Error payload of an `ok:false` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostBridgeError {
    pub code: &'static str,
    pub message: String,
}

impl HostBridgeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_arguments(message: impl Into<String>) -> Self {
        Self::new("invalid_arguments", message)
    }

    fn command_failed(message: impl Into<String>) -> Self {
        Self::new("command_failed", message)
    }
}

/// The side effects the bridge can perform. The desktop implementation calls
/// the exact functions behind the `terminal_read_tail` / `gateway_tunnel_*`
/// Tauri commands; tests substitute a recording fake.
#[async_trait]
pub trait HostBridgeBackend: Send + Sync + 'static {
    fn terminal_read_tail(
        &self,
        project_path_key: String,
        session_id: Option<String>,
        max_bytes: Option<usize>,
    ) -> Result<TerminalReadTailResponse, String>;
}

/// Desktop backend: the terminal registry and the gateway controller the Tauri
/// commands use.
pub struct DesktopHostBridgeBackend {
    terminals: Arc<TerminalSessionRegistry>,
}

impl DesktopHostBridgeBackend {
    pub fn new(_app: tauri::AppHandle, terminals: Arc<TerminalSessionRegistry>) -> Self {
        Self { terminals }
    }
}

#[async_trait]
impl HostBridgeBackend for DesktopHostBridgeBackend {
    fn terminal_read_tail(
        &self,
        project_path_key: String,
        session_id: Option<String>,
        max_bytes: Option<usize>,
    ) -> Result<TerminalReadTailResponse, String> {
        // Same call as `commands::terminal::terminal_read_tail`, including its
        // project scoping.
        self.terminals
            .read_tail(project_path_key, session_id, max_bytes)
    }
}

/// Mirrors `buildGatewayPublicBaseUrl` (agent-ui `lib/shared/gatewayPublicUrl.ts`),
/// which the frontend `TunnelManager` used to compose public tunnel URLs.

struct ServerState {
    endpoint: HostBridgeEndpoint,
    backend: Arc<dyn HostBridgeBackend>,
}

/// Generates the per-launch bearer token from the OS CSPRNG.
fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("failed to generate host bridge token: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Binds the loopback listener and serves the bridge on the Tauri runtime.
pub fn start(backend: Arc<dyn HostBridgeBackend>) -> Result<HostBridgeEndpoint, String> {
    let (listener, endpoint) = bind_loopback()?;
    let router = router(endpoint.clone(), backend);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("failed to convert host bridge listener: {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("host bridge server stopped unexpectedly: {error}");
        }
    });
    Ok(endpoint)
}

fn bind_loopback() -> Result<(TcpListener, HostBridgeEndpoint), String> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| format!("failed to bind host bridge listener: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure host bridge listener: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("failed to read host bridge address: {error}"))?;
    let endpoint = HostBridgeEndpoint {
        url: format!("http://{addr}"),
        port: addr.port(),
        token: Arc::from(generate_token()?),
    };
    Ok((listener, endpoint))
}

fn router(endpoint: HostBridgeEndpoint, backend: Arc<dyn HostBridgeBackend>) -> Router {
    let state = Arc::new(ServerState { endpoint, backend });
    Router::new()
        .route("/v1/host/{command}", any(handle_command))
        .fallback(handle_fallback)
        .with_state(state)
}

fn json_response(status: StatusCode, body: Value) -> Response {
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn error_response(status: StatusCode, error: HostBridgeError) -> Response {
    json_response(status, json!({ "ok": false, "error": error }))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let diff = left
        .iter()
        .zip(right)
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b));
    std::hint::black_box(diff) == 0
}

/// `Host` must name this loopback listener; anything else is a rebinding attempt.
fn host_is_loopback_listener(headers: &HeaderMap, port: u16) -> bool {
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let host = host.trim().to_ascii_lowercase();
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

fn is_browser_request(headers: &HeaderMap) -> bool {
    headers.contains_key(header::ORIGIN)
        || headers
            .keys()
            .any(|name| name.as_str().starts_with("sec-fetch-"))
}

fn bearer_matches(headers: &HeaderMap, token: &str) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some((scheme, presented)) = value.trim().split_once(' ') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer")
        && constant_time_eq(presented.trim().as_bytes(), token.as_bytes())
}

/// Shared request guards; `Err` is the refusal to send.
fn guard(state: &ServerState, headers: &HeaderMap) -> Result<(), Response> {
    if !host_is_loopback_listener(headers, state.endpoint.port) || is_browser_request(headers) {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            HostBridgeError::new("forbidden", "request refused"),
        ));
    }
    if !bearer_matches(headers, state.endpoint.token()) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            HostBridgeError::new("unauthorized", "missing or invalid bearer token"),
        ));
    }
    Ok(())
}

async fn handle_fallback(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if let Err(response) = guard(&state, &headers) {
        return response;
    }
    error_response(
        StatusCode::NOT_FOUND,
        HostBridgeError::new("not_found", "unknown endpoint"),
    )
}

async fn handle_command(
    State(state): State<Arc<ServerState>>,
    Path(command): Path<String>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> Response {
    if let Err(response) = guard(&state, &headers) {
        return response;
    }
    if method != Method::POST {
        return error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            HostBridgeError::new("method_not_allowed", "use POST"),
        );
    }
    let declared_too_large = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .is_some_and(|length| length > MAX_BODY_BYTES as u64);
    let too_large = || {
        error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            HostBridgeError::new(
                "payload_too_large",
                format!("request body exceeds {MAX_BODY_BYTES} bytes"),
            ),
        )
    };
    if declared_too_large {
        return too_large();
    }
    let Ok(bytes) = to_bytes(body, MAX_BODY_BYTES).await else {
        return too_large();
    };
    let outcome = dispatch(
        state.backend.as_ref(),
        state.endpoint.port,
        &command,
        &bytes,
    )
    .await;
    match outcome {
        Ok(result) => json_response(StatusCode::OK, json!({ "ok": true, "result": result })),
        Err(error) => error_response(StatusCode::OK, error),
    }
}

/// Body = JSON object of arguments; an empty body means `{}`.
fn parse_args<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, HostBridgeError> {
    let value: Value = if bytes.iter().all(u8::is_ascii_whitespace) {
        Value::Object(Default::default())
    } else {
        serde_json::from_slice(bytes)
            .map_err(|error| HostBridgeError::invalid_arguments(format!("invalid JSON: {error}")))?
    };
    if !value.is_object() {
        return Err(HostBridgeError::invalid_arguments(
            "arguments must be a JSON object",
        ));
    }
    serde_json::from_value(value)
        .map_err(|error| HostBridgeError::invalid_arguments(error.to_string()))
}

fn to_result<T: Serialize>(value: &T) -> Result<Value, HostBridgeError> {
    serde_json::to_value(value)
        .map_err(|error| HostBridgeError::command_failed(format!("serialize result: {error}")))
}

#[derive(Deserialize)]
struct TerminalReadTailArgs {
    project_path_key: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    max_bytes: Option<usize>,
}

pub(crate) async fn dispatch(
    backend: &dyn HostBridgeBackend,
    _bridge_port: u16,
    command: &str,
    body: &[u8],
) -> Result<Value, HostBridgeError> {
    match command {
        "terminal_read_tail" => {
            let args: TerminalReadTailArgs = parse_args(body)?;
            let response = backend
                .terminal_read_tail(args.project_path_key, args.session_id, args.max_bytes)
                .map_err(HostBridgeError::command_failed)?;
            to_result(&response)
        }
        _ => Err(HostBridgeError::new(
            "unknown_command",
            format!("unknown host bridge command: {command}"),
        )),
    }
}
