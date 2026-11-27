use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, put},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch;

use super::registration::{advertised_tools, HostBridgeState, HostBridgeStatus};
use super::*;
use crate::services::kbrain_backend::KBrainBackendConnection;

// ---------------------------------------------------------------------------
// Fake backend: terminal reads go to a real registry (so its project scoping is
// exercised); only local terminal calls are recorded.

#[derive(Debug, Clone, PartialEq)]
enum Call {
    ReadTail(String, Option<String>, Option<usize>),
}
struct FakeBackend {
    terminals: Arc<TerminalSessionRegistry>,
    calls: Mutex<Vec<Call>>,
}
impl FakeBackend {
    fn new(_legacy: bool) -> Arc<Self> {
        Arc::new(Self {
            terminals: Arc::new(TerminalSessionRegistry::default()),
            calls: Mutex::new(Vec::new()),
        })
    }
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
}
#[async_trait]
impl HostBridgeBackend for FakeBackend {
    fn terminal_read_tail(
        &self,
        project_path_key: String,
        session_id: Option<String>,
        max_bytes: Option<usize>,
    ) -> Result<TerminalReadTailResponse, String> {
        self.calls.lock().unwrap().push(Call::ReadTail(
            project_path_key.clone(),
            session_id.clone(),
            max_bytes,
        ));
        self.terminals
            .read_tail(project_path_key, session_id, max_bytes)
    }
}

// // Server + raw HTTP client (raw so tests control every header, including Host).

struct TestServer {
    endpoint: HostBridgeEndpoint,
    addr: SocketAddr,
}

async fn serve(backend: Arc<dyn HostBridgeBackend>) -> TestServer {
    let (listener, endpoint) = bind_loopback().expect("bind host bridge");
    let addr = listener.local_addr().expect("local addr");
    let app = router(endpoint.clone(), backend);
    let listener = tokio::net::TcpListener::from_std(listener).expect("tokio listener");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve host bridge");
    });
    TestServer { endpoint, addr }
}

struct RawResponse {
    status: u16,
    headers: String,
    body: Value,
}

async fn raw_request(addr: SocketAddr, head: &str, body: &[u8]) -> RawResponse {
    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
    let mut request = head.as_bytes().to_vec();
    request.extend_from_slice(body);
    // The server may answer (413) and close before the whole body is written.
    let _ = stream.write_all(&request).await;
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw).await;
    let text = String::from_utf8_lossy(&raw).to_string();
    let (head, body) = text.split_once("\r\n\r\n").expect("http response");
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("status code");
    RawResponse {
        status,
        headers: head.to_ascii_lowercase(),
        body: serde_json::from_str(body).unwrap_or(Value::Null),
    }
}

impl TestServer {
    fn host(&self) -> String {
        format!("127.0.0.1:{}", self.endpoint.port)
    }

    fn auth(&self) -> String {
        format!("Bearer {}", self.endpoint.token())
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        extra_headers: &[(&str, String)],
        body: &str,
    ) -> RawResponse {
        let mut head = format!(
            "{method} {path} HTTP/1.1\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        );
        for (name, value) in extra_headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        raw_request(self.addr, &head, body.as_bytes()).await
    }

    async fn post(&self, command: &str, body: &str) -> RawResponse {
        self.send(
            "POST",
            &format!("/v1/host/{command}"),
            &[("Host", self.host()), ("Authorization", self.auth())],
            body,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// Listener and token

#[tokio::test]
async fn listener_binds_loopback_only_with_a_fresh_token() {
    let (listener, endpoint) = bind_loopback().expect("bind");
    let addr = listener.local_addr().unwrap();
    assert_eq!(addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert!(!addr.ip().is_unspecified());
    assert_ne!(addr.port(), 0);
    assert_eq!(endpoint.url(), format!("http://127.0.0.1:{}", addr.port()));
    // 32 CSPRNG bytes, hex encoded.
    assert_eq!(endpoint.token().len(), TOKEN_BYTES * 2);
    assert!(endpoint.token().chars().all(|c| c.is_ascii_hexdigit()));
    let (_other_listener, other) = bind_loopback().expect("bind again");
    assert_ne!(endpoint.token(), other.token());
}

#[test]
fn endpoint_debug_redacts_the_token() {
    let (_listener, endpoint) = bind_loopback().expect("bind");
    let printed = format!("{endpoint:?}");
    assert!(!printed.contains(endpoint.token()));
    assert!(printed.contains("<redacted>"));
}

// ---------------------------------------------------------------------------
// Guards

#[tokio::test]
async fn requests_without_or_with_wrong_bearer_are_unauthorized() {
    let backend = FakeBackend::new(true);
    let server = serve(backend.clone()).await;
    let missing = server
        .send(
            "POST",
            "/v1/host/gateway_tunnel_state",
            &[("Host", server.host())],
            "{}",
        )
        .await;
    assert_eq!(missing.status, 401);
    assert_eq!(missing.body["ok"], false);
    assert_eq!(missing.body["error"]["code"], "unauthorized");

    let wrong_token = format!("Bearer {}", "0".repeat(TOKEN_BYTES * 2));
    let wrong = server
        .send(
            "POST",
            "/v1/host/gateway_tunnel_state",
            &[("Host", server.host()), ("Authorization", wrong_token)],
            "{}",
        )
        .await;
    assert_eq!(wrong.status, 401);

    let prefix = format!("Bearer {}", &server.endpoint.token()[..10]);
    let truncated = server
        .send(
            "POST",
            "/v1/host/gateway_tunnel_state",
            &[("Host", server.host()), ("Authorization", prefix)],
            "{}",
        )
        .await;
    assert_eq!(truncated.status, 401);

    let basic = server
        .send(
            "POST",
            "/v1/host/gateway_tunnel_state",
            &[
                ("Host", server.host()),
                (
                    "Authorization",
                    format!("Basic {}", server.endpoint.token()),
                ),
            ],
            "{}",
        )
        .await;
    assert_eq!(basic.status, 401);
    // Unknown paths are guarded too and do not reveal anything.
    let unknown_path = server
        .send("POST", "/v1/other", &[("Host", server.host())], "{}")
        .await;
    assert_eq!(unknown_path.status, 401);
    assert!(backend.calls().is_empty());

    let ok = server
        .post("terminal_read_tail", r#"{"project_path_key":"/repo"}"#)
        .await;
    assert_eq!(ok.status, 200);
    assert_eq!(ok.body["ok"], true);
    assert!(ok.headers.contains("cache-control: no-store"));
}

#[tokio::test]
async fn non_loopback_host_headers_are_refused() {
    let backend = FakeBackend::new(true);
    let server = serve(backend.clone()).await;
    let port = server.endpoint.port;
    for host in [
        format!("evil.example:{port}"),
        format!("127.0.0.1.nip.io:{port}"),
        "127.0.0.1".to_string(),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
        format!("0.0.0.0:{port}"),
    ] {
        let response = server
            .send(
                "POST",
                "/v1/host/gateway_tunnel_state",
                &[("Host", host.clone()), ("Authorization", server.auth())],
                "{}",
            )
            .await;
        assert_eq!(response.status, 403, "host {host} must be refused");
        assert_eq!(response.body["error"]["code"], "forbidden");
    }
    let localhost = server
        .send(
            "POST",
            "/v1/host/gateway_tunnel_state",
            &[
                ("Host", format!("localhost:{port}")),
                ("Authorization", server.auth()),
            ],
            "{}",
        )
        .await;
    assert_eq!(localhost.status, 200);
    assert!(backend.calls().is_empty());
    assert_eq!(localhost.body["error"]["code"], "unknown_command");
}

#[tokio::test]
async fn browser_requests_are_refused_even_with_the_token() {
    let backend = FakeBackend::new(true);
    let server = serve(backend.clone()).await;
    for (name, value) in [
        ("Origin", "http://127.0.0.1".to_string()),
        ("Origin", "null".to_string()),
        ("Sec-Fetch-Mode", "cors".to_string()),
        ("Sec-Fetch-Site", "cross-site".to_string()),
    ] {
        let response = server
            .send(
                "POST",
                "/v1/host/gateway_tunnel_state",
                &[
                    ("Host", server.host()),
                    ("Authorization", server.auth()),
                    (name, value),
                ],
                "{}",
            )
            .await;
        assert_eq!(response.status, 403, "{name} must be refused");
    }
    assert!(backend.calls().is_empty());
}

#[tokio::test]
async fn only_post_is_accepted() {
    let backend = FakeBackend::new(true);
    let server = serve(backend.clone()).await;
    let response = server
        .send(
            "GET",
            "/v1/host/gateway_tunnel_state",
            &[("Host", server.host()), ("Authorization", server.auth())],
            "",
        )
        .await;
    assert_eq!(response.status, 405);
    assert!(backend.calls().is_empty());
}

#[tokio::test]
async fn oversized_bodies_are_rejected() {
    let backend = FakeBackend::new(true);
    let server = serve(backend.clone()).await;
    let padding = "x".repeat(MAX_BODY_BYTES + 1);
    let body = format!(r#"{{"tunnel_id":"{padding}"}}"#);
    let declared = server.post("gateway_tunnel_close", &body).await;
    assert_eq!(declared.status, 413);
    assert_eq!(declared.body["error"]["code"], "payload_too_large");

    // Chunked: no Content-Length, the streaming limit applies.
    let chunk = body.as_bytes();
    let mut chunked = format!("{:x}\r\n", chunk.len()).into_bytes();
    chunked.extend_from_slice(chunk);
    chunked.extend_from_slice(b"\r\n0\r\n\r\n");
    let head = format!(
        "POST /v1/host/gateway_tunnel_close HTTP/1.1\r\nConnection: close\r\nHost: {}\r\nAuthorization: {}\r\nTransfer-Encoding: chunked\r\n\r\n",
        server.host(),
        server.auth()
    );
    let streamed = raw_request(server.addr, &head, &chunked).await;
    assert_eq!(streamed.status, 413);
    assert!(backend.calls().is_empty());

    // Just under the cap is fine.
    let fits = format!(
        r#"{{"project_path_key":"/repo","padding":"{}"}}"#,
        "y".repeat(MAX_BODY_BYTES - r#"{"project_path_key":"/repo","padding":""}"#.len())
    );
    assert_eq!(fits.len(), MAX_BODY_BYTES);
    let accepted = server.post("terminal_read_tail", &fits).await;
    assert_eq!(accepted.status, 200);
    assert_eq!(accepted.body["ok"], true);
}

// ---------------------------------------------------------------------------
// Dispatch

#[tokio::test]
async fn remote_commands_are_unavailable() {
    let backend = FakeBackend::new(false);
    let server = serve(backend.clone()).await;
    for command in [
        "gateway_tunnel_state",
        "gateway_tunnel_create",
        "gateway_tunnel_close",
        "gateway_tunnel_check",
        "ssh_terminal_create",
        "shell_exec",
    ] {
        let response = server.post(command, "{}").await;
        assert_eq!(response.body["ok"], false);
        assert_eq!(response.body["error"]["code"], "unknown_command");
    }
    assert!(backend.calls().is_empty());
}

#[tokio::test]
async fn terminal_read_tail_uses_the_registry_project_scoping() {
    let backend = FakeBackend::new(false);
    let server = serve(backend.clone()).await;
    let project = tempfile::tempdir().expect("project dir");
    let other = tempfile::tempdir().expect("other project dir");
    let project_key = project.path().display().to_string();
    let other_key = other.path().display().to_string();

    let empty = server
        .post(
            "terminal_read_tail",
            &json!({"project_path_key": project_key}).to_string(),
        )
        .await;
    assert_eq!(empty.body["ok"], true);
    assert_eq!(empty.body["result"]["sessions"], json!([]));
    assert_eq!(empty.body["result"]["selectedSession"], Value::Null);

    let session = backend
        .terminals
        .create(
            other_key.clone(),
            Some(other_key.clone()),
            None,
            Some("Other".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create terminal");
    let session_id = session.session.id.clone();

    let own = server
        .post(
            "terminal_read_tail",
            &json!({"project_path_key": other_key, "session_id": session_id, "max_bytes": 512})
                .to_string(),
        )
        .await;
    assert_eq!(own.body["ok"], true, "{}", own.body);
    assert_eq!(own.body["result"]["selectedSession"]["id"], session_id);
    assert!(own.body["result"]["output"].is_string());

    // Another project's terminal is never read: with no own sessions the
    // result is empty...
    let foreign_empty = server
        .post(
            "terminal_read_tail",
            &json!({"project_path_key": project_key, "session_id": session_id}).to_string(),
        )
        .await;
    assert_eq!(foreign_empty.body["ok"], true);
    assert_eq!(foreign_empty.body["result"]["sessions"], json!([]));
    assert_eq!(foreign_empty.body["result"]["output"], "");

    // ...and with own sessions an explicit foreign id is refused.
    backend
        .terminals
        .create(
            project_key.clone(),
            Some(project_key.clone()),
            None,
            Some("Own".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create own terminal");
    let foreign = server
        .post(
            "terminal_read_tail",
            &json!({"project_path_key": project_key, "session_id": session_id}).to_string(),
        )
        .await;
    assert_eq!(foreign.body["ok"], false);
    assert_eq!(foreign.body["error"]["code"], "command_failed");
    assert_eq!(
        foreign.body["error"]["message"],
        "terminal session is outside the current project"
    );

    let blank = server
        .post("terminal_read_tail", r#"{"project_path_key":"  "}"#)
        .await;
    assert_eq!(blank.body["error"]["code"], "command_failed");

    assert_eq!(
        backend.calls()[1],
        Call::ReadTail(other_key, Some(session_id), Some(512))
    );
    backend.terminals.close_all().expect("close terminals");
}

const KBRAIN_TOKEN: &str = "kbrain-test-token";

#[derive(Default)]
struct StubKBrain {
    host_bridge_capability: Mutex<Option<Value>>,
    put_status: Mutex<u16>,
    puts: Mutex<Vec<Value>>,
    deletes: Mutex<u32>,
    health_checks: Mutex<u32>,
}

fn stub_authorized(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {KBRAIN_TOKEN}"))
}

async fn stub_health(
    State(stub): State<Arc<StubKBrain>>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    if !stub_authorized(&headers) {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    *stub.health_checks.lock().unwrap() += 1;
    let mut capabilities = json!({"runs": 1});
    if let Some(value) = stub.host_bridge_capability.lock().unwrap().clone() {
        capabilities["host_bridge"] = value;
    }
    (
        StatusCode::OK,
        Json(json!({"status": "ok", "capabilities": capabilities})),
    )
}

async fn stub_put(
    State(stub): State<Arc<StubKBrain>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> StatusCode {
    if !stub_authorized(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let status = *stub.put_status.lock().unwrap();
    if status != 200 {
        return StatusCode::from_u16(status).unwrap();
    }
    stub.puts.lock().unwrap().push(body);
    StatusCode::NO_CONTENT
}

async fn stub_delete(State(stub): State<Arc<StubKBrain>>, headers: HeaderMap) -> StatusCode {
    if !stub_authorized(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    *stub.deletes.lock().unwrap() += 1;
    StatusCode::NO_CONTENT
}

async fn start_stub(capability: Option<Value>) -> (Arc<StubKBrain>, KBrainBackendConnection) {
    let stub = Arc::new(StubKBrain::default());
    *stub.host_bridge_capability.lock().unwrap() = capability;
    *stub.put_status.lock().unwrap() = 200;
    let app = Router::new()
        .route("/v1/health", get(stub_health))
        .route("/v1/host-bridge", put(stub_put).delete(stub_delete))
        .with_state(Arc::clone(&stub));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let connection = KBrainBackendConnection {
        base_url: format!("http://{addr}"),
        token: KBRAIN_TOKEN.to_string(),
        protocol_version: "kbrain.agent.v1".to_string(),
        storage_id: "test".to_string(),
    };
    (stub, connection)
}

fn registrar() -> (
    Arc<HostBridgeRegistrar>,
    HostBridgeEndpoint,
    Arc<Mutex<Vec<HostBridgeStatus>>>,
) {
    let (_listener, endpoint) = bind_loopback().expect("bind");
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let registrar = HostBridgeRegistrar::new(
        endpoint.clone(),
        Box::new(move |status: &HostBridgeStatus| sink.lock().unwrap().push(status.clone())),
    )
    .expect("registrar");
    (Arc::new(registrar), endpoint, events)
}

fn tools(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

async fn wait_until(mut condition: impl FnMut() -> bool) {
    for _ in 0..200 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("condition not reached in time");
}

#[tokio::test]
async fn registers_when_kbrain_reports_the_capability() {
    let (stub, connection) = start_stub(Some(json!(1))).await;
    let (registrar, endpoint, events) = registrar();
    let status = registrar
        .sync(
            Some(connection.clone()),
            tools(&["ReadTerminal", "TunnelManager"]),
            false,
        )
        .await;
    assert_eq!(status.state, HostBridgeState::Registered);
    assert_eq!(status.tools, tools(&["ReadTerminal", "TunnelManager"]));
    let puts = stub.puts.lock().unwrap().clone();
    assert_eq!(
        puts,
        vec![json!({
            "url": endpoint.url(),
            "token": endpoint.token(),
            "host": "liveagent-desktop",
            "tools": ["ReadTerminal", "TunnelManager"],
        })]
    );
    assert!(endpoint.url().starts_with("http://127.0.0.1:"));

    // The frontend-visible status never carries the URL or the token.
    let visible = serde_json::to_string(&registrar.status()).unwrap();
    assert!(!visible.contains(endpoint.token()));
    assert!(!visible.contains(endpoint.url()));
    assert_eq!(
        serde_json::from_str::<Value>(&visible).unwrap(),
        json!({"state": "registered", "tools": ["ReadTerminal", "TunnelManager"]})
    );

    // Unchanged registration is not re-sent; a forced refresh is.
    registrar
        .sync(
            Some(connection.clone()),
            tools(&["ReadTerminal", "TunnelManager"]),
            false,
        )
        .await;
    assert_eq!(stub.puts.lock().unwrap().len(), 1);
    registrar
        .sync(
            Some(connection),
            tools(&["ReadTerminal", "TunnelManager"]),
            true,
        )
        .await;
    assert_eq!(stub.puts.lock().unwrap().len(), 2);
    assert_eq!(
        events.lock().unwrap().len(),
        1,
        "status only emitted on change"
    );
}

#[tokio::test]
async fn older_kbrain_without_the_capability_is_skipped_silently() {
    for capability in [None, Some(json!(0)), Some(json!(2)), Some(json!("1"))] {
        let (stub, connection) = start_stub(capability.clone()).await;
        let (registrar, _endpoint, _events) = registrar();
        let status = registrar
            .sync(Some(connection), tools(&["ReadTerminal"]), false)
            .await;
        assert_eq!(status.state, HostBridgeState::Unsupported, "{capability:?}");
        assert!(status.tools.is_empty());
        assert!(stub.puts.lock().unwrap().is_empty(), "{capability:?}");
    }
}

#[tokio::test]
async fn failed_registration_reports_failed_without_leaking_secrets() {
    let (stub, connection) = start_stub(Some(json!(1))).await;
    *stub.put_status.lock().unwrap() = 500;
    let (registrar, _endpoint, _events) = registrar();
    let status = registrar
        .sync(Some(connection.clone()), tools(&["ReadTerminal"]), false)
        .await;
    assert_eq!(status.state, HostBridgeState::Failed);
    assert!(status.tools.is_empty());

    // Unreachable backend.
    let mut gone = connection;
    gone.base_url = "http://127.0.0.1:9".to_string();
    let status = registrar
        .sync(Some(gone), tools(&["ReadTerminal"]), false)
        .await;
    assert_eq!(status.state, HostBridgeState::Failed);

    let status = registrar.sync(None, tools(&["ReadTerminal"]), false).await;
    assert_eq!(status.state, HostBridgeState::Disconnected);
}

#[tokio::test]
async fn follower_reregisters_on_restart() {
    let (first_stub, first) = start_stub(Some(json!(1))).await;
    let (second_stub, second) = start_stub(Some(json!(1))).await;
    let (registrar, endpoint, _events) = registrar();
    let (kbrain_tx, kbrain_rx) = watch::channel(None::<KBrainBackendConnection>);
    let follower = tokio::spawn(Arc::clone(&registrar).follow(kbrain_rx));

    kbrain_tx.send_replace(Some(first.clone()));
    wait_until(|| first_stub.puts.lock().unwrap().len() == 1).await;
    assert_eq!(
        first_stub.puts.lock().unwrap()[0]["tools"],
        json!(["ReadTerminal"])
    );

    // K-brain restart (new port/token): register again with the same bridge.
    kbrain_tx.send_replace(Some(second));
    wait_until(|| second_stub.puts.lock().unwrap().len() == 1).await;
    assert_eq!(second_stub.puts.lock().unwrap()[0]["url"], endpoint.url());
    assert_eq!(
        second_stub.puts.lock().unwrap()[0]["token"],
        endpoint.token()
    );

    // Backend stopped.
    kbrain_tx.send_replace(None);
    wait_until(|| registrar.status().state == HostBridgeState::Disconnected).await;

    // Same K-brain back again (e.g. restarted on the same port) re-registers.
    kbrain_tx.send_replace(Some(first));
    wait_until(|| first_stub.puts.lock().unwrap().len() == 2).await;
    follower.abort();
}

#[tokio::test]
async fn follower_retries_after_a_failed_registration() {
    let (stub, connection) = start_stub(Some(json!(1))).await;
    *stub.put_status.lock().unwrap() = 503;
    let (registrar, _endpoint, _events) = registrar();
    let (_kbrain_tx, kbrain_rx) = watch::channel(Some(connection));
    let follower = tokio::spawn(Arc::clone(&registrar).follow(kbrain_rx));
    wait_until(|| registrar.status().state == HostBridgeState::Failed).await;
    *stub.put_status.lock().unwrap() = 200;
    wait_until(|| registrar.status().state == HostBridgeState::Registered).await;
    assert_eq!(stub.puts.lock().unwrap().len(), 1);
    follower.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exit_deletes_the_registration_once() {
    let (stub, connection) = start_stub(Some(json!(1))).await;
    let (registrar, _endpoint, events) = registrar();
    registrar
        .sync(Some(connection.clone()), tools(&["ReadTerminal"]), false)
        .await;
    assert_eq!(registrar.status().state, HostBridgeState::Registered);

    let exiting = Arc::clone(&registrar);
    tokio::task::spawn_blocking(move || {
        exiting.unregister_for_exit();
        // ExitRequested and Exit both call it; the second is a no-op.
        exiting.unregister_for_exit();
    })
    .await
    .unwrap();
    assert_eq!(*stub.deletes.lock().unwrap(), 1);
    assert_eq!(registrar.status().state, HostBridgeState::Disconnected);
    assert_eq!(
        events.lock().unwrap().last().map(|status| status.state),
        Some(HostBridgeState::Disconnected)
    );

    // No re-registration once exiting.
    let status = registrar
        .sync(Some(connection), tools(&["ReadTerminal"]), true)
        .await;
    assert_eq!(status.state, HostBridgeState::Disconnected);
    assert_eq!(stub.puts.lock().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exit_without_registration_sends_nothing() {
    let (stub, connection) = start_stub(None).await;
    let (registrar, _endpoint, _events) = registrar();
    registrar
        .sync(Some(connection), tools(&["ReadTerminal"]), false)
        .await;
    let exiting = Arc::clone(&registrar);
    tokio::task::spawn_blocking(move || exiting.unregister_for_exit())
        .await
        .unwrap();
    assert_eq!(*stub.deletes.lock().unwrap(), 0);
}

#[test]
fn advertised_tools_are_local_only() {
    assert_eq!(advertised_tools(), tools(&["ReadTerminal"]));
}
