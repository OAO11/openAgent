use portable_pty::CommandBuilder;

use crate::runtime::project_path::project_path_key as normalize_project_path_key;

use super::*;

#[test]
fn shell_options_include_default() {
    let options = terminal_shell_options();
    assert!(!options.default_shell.trim().is_empty());
    assert!(!options.options.is_empty());
}

#[test]
fn output_tail_respects_byte_limit_inside_large_chunk() {
    let mut output = TerminalOutputBuffer::default();
    output.append(b"prefix".to_vec());
    output.append(b"abcdefghijklmnopqrstuvwxyz".to_vec());

    let tail = read_output_chunks_tail(&output, 8);

    assert_eq!(tail.output, b"stuvwxyz");
    assert_eq!(tail.output_start_offset, 24);
    assert_eq!(tail.output_end_offset, 32);
    assert!(tail.truncated);
}

#[test]
fn output_tail_keeps_offsets_for_repeated_text() {
    let mut output = TerminalOutputBuffer::default();
    output.append(b"uploads\n".to_vec());
    output.append(b"uploads\n".to_vec());

    let tail = read_output_chunks_tail(&output, MAX_TAIL_BYTES);

    assert_eq!(tail.output, b"uploads\nuploads\n");
    assert_eq!(tail.output_start_offset, 0);
    assert_eq!(tail.output_end_offset, 16);
    assert!(!tail.truncated);
}

#[test]
fn remote_input_echo_is_delayed_for_local_until_enter() {
    let mut state = TerminalEchoDispatchState::default();
    state
        .pending
        .extend(b"echo hi\r".iter().copied().map(|byte| PendingEchoByte {
            byte,
            origin: TerminalInputOrigin::Remote,
        }));

    let first = state.dispatch(test_stream_payload(0, b"echo"));
    assert_eq!(collect_payload_bytes(&first.remote), b"echo");
    assert!(first.local.is_empty());

    let second = state.dispatch(test_stream_payload(4, b" hi\r\n"));
    assert_eq!(collect_payload_bytes(&second.remote), b" hi\r\n");
    assert_eq!(collect_payload_bytes(&second.local), b"echo hi\r\n");
    assert!(state.is_empty());
}

#[test]
fn local_input_echo_is_delayed_for_remote_until_enter() {
    let mut state = TerminalEchoDispatchState::default();
    state
        .pending
        .extend(b"pwd\r".iter().copied().map(|byte| PendingEchoByte {
            byte,
            origin: TerminalInputOrigin::Local,
        }));

    let first = state.dispatch(test_stream_payload(10, b"pw"));
    assert_eq!(collect_payload_bytes(&first.local), b"pw");
    assert!(first.remote.is_empty());

    let second = state.dispatch(test_stream_payload(12, b"d\r\n"));
    assert_eq!(collect_payload_bytes(&second.local), b"d\r\n");
    assert_eq!(collect_payload_bytes(&second.remote), b"pwd\r\n");
    assert!(state.is_empty());
}

#[test]
fn no_echo_password_input_does_not_leak_to_other_side() {
    let mut state = TerminalEchoDispatchState::default();
    state
        .pending
        .extend(b"secret\r".iter().copied().map(|byte| PendingEchoByte {
            byte,
            origin: TerminalInputOrigin::Remote,
        }));

    let dispatch = state.dispatch(test_stream_payload(30, b"\r\n"));

    assert_eq!(collect_payload_bytes(&dispatch.local), b"\r\n");
    assert_eq!(collect_payload_bytes(&dispatch.remote), b"\r\n");
    assert!(state.is_empty());
}

#[test]
fn non_echo_output_stays_visible_to_both_sides() {
    let mut state = TerminalEchoDispatchState::default();
    state.pending.push_back(PendingEchoByte {
        byte: b'a',
        origin: TerminalInputOrigin::Remote,
    });

    let dispatch = state.dispatch(test_stream_payload(50, b"build\n"));

    assert_eq!(collect_payload_bytes(&dispatch.local), b"build\n");
    assert_eq!(collect_payload_bytes(&dispatch.remote), b"build\n");
    assert!(!state.is_empty());
}

#[test]
fn input_echo_candidates_skip_escape_sequences() {
    let candidates =
        terminal_input_echo_candidates(b"a\x1b[A\x1b[1;5Cb\r", TerminalInputOrigin::Remote);
    let bytes = candidates
        .iter()
        .map(|candidate| candidate.byte)
        .collect::<Vec<_>>();

    assert_eq!(bytes, b"ab\r");
}

fn block_on_test<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build test runtime")
        .block_on(future)
}

fn test_stream_payload(start_offset: u64, bytes: &[u8]) -> TerminalStreamEventPayload {
    TerminalStreamEventPayload {
        kind: "output".to_string(),
        session_id: "terminal-1".to_string(),
        project_path_key: "/tmp/project".to_string(),
        start_offset,
        end_offset: start_offset + bytes.len() as u64,
        bytes: bytes.to_vec(),
    }
}

fn collect_payload_bytes(payloads: &[TerminalStreamEventPayload]) -> Vec<u8> {
    payloads
        .iter()
        .flat_map(|payload| payload.bytes.iter().copied())
        .collect()
}

#[test]
fn terminal_shell_env_scrubs_npm_prefix() {
    let mut command = CommandBuilder::new("/bin/sh");
    command.env("npm_config_prefix", "/tmp/npm-prefix");
    command.env("NPM_CONFIG_PREFIX", "/tmp/npm-prefix");
    command.env("TERM", "dumb");

    configure_terminal_shell_env(&mut command, "/bin/sh");

    assert!(command.get_env("npm_config_prefix").is_none());
    assert!(command.get_env("NPM_CONFIG_PREFIX").is_none());
    assert_eq!(
        command.get_env("TERM").and_then(|value| value.to_str()),
        Some("xterm-256color")
    );
    assert_eq!(
        command
            .get_env("COLORTERM")
            .and_then(|value| value.to_str()),
        Some("truecolor")
    );
    assert!(command.get_env("PROMPT_EOL_MARK").is_none());
}

#[test]
fn zsh_terminal_shell_disables_prompt_sp() {
    assert_eq!(
        unix_shell_args("/bin/zsh"),
        vec!["-o".to_string(), "NO_PROMPT_SP".to_string()]
    );
    assert!(unix_shell_args("/bin/bash").is_empty());
}

#[test]
fn registry_creates_lists_renames_and_closes_session() {
    let registry = Arc::new(TerminalSessionRegistry::default());
    let tempdir = tempfile::tempdir().expect("tempdir");
    let cwd = tempdir.path().display().to_string();

    let created = registry
        .create(
            cwd.clone(),
            Some(cwd.clone()),
            None,
            Some("Test Terminal".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create terminal session");
    assert!(created.session.running);
    assert_eq!(created.session.title, "Test Terminal");

    let listed = registry.list(Some(cwd.clone())).sessions;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.session.id);

    let resized = registry
        .resize(created.session.id.clone(), 100, 30)
        .expect("resize terminal session");
    assert_eq!(resized.cols, 100);
    assert_eq!(resized.rows, 30);

    let renamed = registry
        .rename(created.session.id.clone(), "Renamed Terminal".to_string())
        .expect("rename terminal session");
    assert_eq!(renamed.title, "Renamed Terminal");

    let closed = registry
        .close(created.session.id.clone())
        .expect("close terminal session");
    assert!(!closed.running);
    assert!(registry.list(Some(cwd)).sessions.is_empty());
}

#[test]
fn registry_closes_project_sessions() {
    let registry = Arc::new(TerminalSessionRegistry::default());
    let project_a = tempfile::tempdir().expect("project a");
    let project_b = tempfile::tempdir().expect("project b");
    let cwd_a = project_a.path().display().to_string();
    let cwd_b = project_b.path().display().to_string();

    registry
        .create(
            cwd_a.clone(),
            Some(cwd_a.clone()),
            None,
            Some("A".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create project a terminal");
    registry
        .create(
            cwd_b.clone(),
            Some(cwd_b.clone()),
            None,
            Some("B".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create project b terminal");
    assert_eq!(registry.running_session_count(), 2);

    let closed = registry
        .close_project(cwd_a.clone())
        .expect("close project a terminals");
    assert_eq!(closed.sessions.len(), 1);
    assert!(registry.list(Some(cwd_a)).sessions.is_empty());
    assert_eq!(registry.list(Some(cwd_b)).sessions.len(), 1);

    registry.close_all().expect("close remaining terminals");
    assert_eq!(registry.running_session_count(), 0);
}

#[test]
fn read_tail_requires_terminal_id_when_project_has_multiple_sessions() {
    let registry = Arc::new(TerminalSessionRegistry::default());
    let tempdir = tempfile::tempdir().expect("tempdir");
    let cwd = tempdir.path().display().to_string();

    let first = registry
        .create(
            cwd.clone(),
            Some(cwd.clone()),
            None,
            Some("First".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create first terminal session");
    registry
        .create(
            cwd.clone(),
            Some(cwd.clone()),
            None,
            Some("Second".to_string()),
            Some(80),
            Some(24),
        )
        .expect("create second terminal session");

    let ambiguous = registry
        .read_tail(cwd.clone(), None, Some(1024))
        .expect("read ambiguous terminal tail");
    assert_eq!(ambiguous.sessions.len(), 2);
    assert!(ambiguous.selected_session.is_none());
    assert!(ambiguous.output.is_empty());

    let selected = registry
        .read_tail(cwd, Some(first.session.id), Some(1024))
        .expect("read selected terminal tail");
    assert!(selected.selected_session.is_some());
    assert_eq!(selected.sessions.len(), 2);

    registry.close_all().expect("close terminal sessions");
}

#[test]
fn canonicalize_workdir_within_accepts_paths_inside_the_project() {
    let project = tempfile::tempdir().expect("project root");
    let nested = project.path().join("packages").join("app");
    std::fs::create_dir_all(&nested).expect("create nested workdir");
    let root = project.path().display().to_string();

    let resolved = canonicalize_workdir_within(&nested.display().to_string(), &root)
        .expect("nested workdir is inside the project");
    let canonical_root = canonicalize_workdir(&root).expect("canonical project root");
    assert!(resolved.starts_with(&canonical_root));

    let at_root =
        canonicalize_workdir_within(&root, &root).expect("project root itself is in range");
    assert_eq!(at_root, canonical_root);
}

#[test]
fn canonicalize_workdir_within_rejects_paths_outside_the_project() {
    let project = tempfile::tempdir().expect("project root");
    let outside = tempfile::tempdir().expect("outside root");
    let root = project.path().display().to_string();

    let sibling = canonicalize_workdir_within(&outside.path().display().to_string(), &root)
        .expect_err("sibling directory is rejected");
    assert!(
        sibling.contains("outside the current project"),
        "unexpected error: {sibling}"
    );

    let escaped = project.path().join("..");
    let traversal = canonicalize_workdir_within(&escaped.display().to_string(), &root)
        .expect_err("parent traversal is rejected");
    assert!(
        traversal.contains("outside the current project"),
        "unexpected error: {traversal}"
    );

    let unrelated = if cfg!(windows) { r"C:\Windows" } else { "/etc" };
    let absolute = canonicalize_workdir_within(unrelated, &root)
        .expect_err("unrelated absolute path is rejected");
    assert!(
        absolute.contains("outside the current project"),
        "unexpected error: {absolute}"
    );

    let home = canonicalize_workdir_within("~", &root).expect_err("home directory is rejected");
    assert!(
        home.contains("outside the current project") || home.contains("workdir"),
        "unexpected error: {home}"
    );
}

#[cfg(unix)]
#[test]
fn canonicalize_workdir_within_rejects_symlink_escapes() {
    let project = tempfile::tempdir().expect("project root");
    let outside = tempfile::tempdir().expect("outside root");
    let link = project.path().join("escape");
    std::os::unix::fs::symlink(outside.path(), &link).expect("create escaping symlink");

    let error = canonicalize_workdir_within(
        &link.display().to_string(),
        &project.path().display().to_string(),
    )
    .expect_err("symlink pointing outside the project is rejected");
    assert!(
        error.contains("outside the current project"),
        "unexpected error: {error}"
    );
}

#[test]
fn canonicalize_workdir_within_requires_a_project_root() {
    let project = tempfile::tempdir().expect("project root");

    let error = canonicalize_workdir_within(&project.path().display().to_string(), "   ")
        .expect_err("blank project root is rejected");
    assert_eq!(error, "project_path_key is required");
}

#[test]
fn registry_create_requires_project_path_key() {
    let registry = Arc::new(TerminalSessionRegistry::default());
    let tempdir = tempfile::tempdir().expect("tempdir");

    let error = registry
        .create(
            tempdir.path().display().to_string(),
            None,
            None,
            None,
            Some(80),
            Some(24),
        )
        .expect_err("create without a project key is rejected");
    assert_eq!(error, "project_path_key is required");
    assert_eq!(registry.running_session_count(), 0);
}

#[test]
fn registry_create_rejects_cwd_outside_the_project() {
    let registry = Arc::new(TerminalSessionRegistry::default());
    let project = tempfile::tempdir().expect("project root");
    let outside = tempfile::tempdir().expect("outside root");

    let error = registry
        .create(
            outside.path().display().to_string(),
            Some(project.path().display().to_string()),
            None,
            None,
            Some(80),
            Some(24),
        )
        .expect_err("cwd outside the claimed project is rejected");
    assert!(
        error.contains("outside the current project"),
        "unexpected error: {error}"
    );
    assert_eq!(registry.running_session_count(), 0);
}

#[test]
fn terminal_output_bytes_cross_the_webview_as_base64_and_round_trip() {
    // "é" (2 bytes), "€" (3 bytes) and "𝄞" (4 bytes) split across chunk boundaries: every
    // chunk carries the raw bytes, never re-encoded text, so the stream decoder downstream
    // still sees the original sequence.
    let text = "héllo €uro 𝄞 clef\r\n".repeat(700);
    let bytes = text.as_bytes();
    let mut offset = 0usize;
    let mut decoded = Vec::new();
    for size in [1usize, 2, 3, 5, 7, 4096, 8191, 8192].iter().cycle() {
        if offset >= bytes.len() {
            break;
        }
        let end = (offset + size).min(bytes.len());
        let payload = test_stream_payload(offset as u64, &bytes[offset..end]);
        let json = serde_json::to_value(&payload).unwrap();
        assert!(json["bytes"].is_string(), "bytes must be a base64 string");
        let back: TerminalStreamEventPayload = serde_json::from_value(json).unwrap();
        assert_eq!(back.start_offset, offset as u64);
        assert_eq!(back.end_offset, end as u64);
        decoded.extend_from_slice(&back.bytes);
        offset = end;
    }
    assert_eq!(decoded, bytes);
    assert_eq!(String::from_utf8(decoded).unwrap(), text);

    // Chunks cut inside a multibyte sequence are not valid UTF-8 on their own and must survive.
    let euro = "€".as_bytes();
    for cut in 1..euro.len() {
        for part in [&euro[..cut], &euro[cut..]] {
            let json = serde_json::to_string(&test_stream_payload(0, part)).unwrap();
            let back: TerminalStreamEventPayload = serde_json::from_str(&json).unwrap();
            assert_eq!(back.bytes, part);
        }
    }

    // Older payloads with a number array still deserialize.
    let legacy: TerminalStreamEventPayload = serde_json::from_value(serde_json::json!({
        "kind": "output", "sessionId": "t", "projectPathKey": "/p",
        "startOffset": 0, "endOffset": 3, "bytes": [0xe2, 0x82, 0xac],
    }))
    .unwrap();
    assert_eq!(legacy.bytes, euro);
}

fn test_session_record() -> TerminalSessionRecord {
    serde_json::from_value(serde_json::json!({
        "id": "t", "projectPathKey": "/p", "cwd": "/p", "shell": "sh", "title": "t",
        "kind": "local", "pid": null, "cols": 80, "rows": 24, "createdAt": 0, "updatedAt": 0,
        "finishedAt": null, "exitCode": null, "running": true,
    }))
    .unwrap()
}

/// `cargo test --lib terminal::tests::bench_ -- --ignored --nocapture`
#[test]
#[ignore = "benchmark: prints the webview wire size and serialization time of 50 MB of output"]
fn bench_terminal_output_wire_encoding() {
    let line = "drwxr-xr-x  12 user  staff   384 Nov 22 10:00 héllo-€-目录\r\n";
    let output = line.repeat(50 * 1024 * 1024 / line.len());
    let chunks: Vec<_> = output.as_bytes().chunks(8192).collect();
    let mut array_size = 0usize;
    let started = std::time::Instant::now();
    for (index, chunk) in chunks.iter().enumerate() {
        // The previous wire format: a plain `Vec<u8>` field.
        let json = serde_json::to_string(&serde_json::json!({
            "kind": "output", "sessionId": "terminal-1", "projectPathKey": "/tmp/project",
            "startOffset": index * 8192, "endOffset": index * 8192 + chunk.len(), "bytes": chunk,
        }))
        .unwrap();
        array_size += json.len();
    }
    let array_time = started.elapsed();
    let mut base64_size = 0usize;
    let started = std::time::Instant::now();
    for (index, chunk) in chunks.iter().enumerate() {
        let json =
            serde_json::to_string(&test_stream_payload((index * 8192) as u64, chunk)).unwrap();
        base64_size += json.len();
    }
    let base64_time = started.elapsed();
    println!(
        "{} chunks of 8 KiB ({} bytes): number array {} bytes in {:?}; base64 {} bytes in {:?}",
        chunks.len(),
        output.len(),
        array_size,
        array_time,
        base64_size,
        base64_time
    );
}
