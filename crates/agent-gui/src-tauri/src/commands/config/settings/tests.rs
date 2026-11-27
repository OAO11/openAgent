#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn open_memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        initialize_schema(&conn).expect("initialize schema");
        conn
    }

    fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("prepare table info");
        stmt.query_map([], |row| row.get::<_, String>(1))
            .expect("query table info")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect table columns")
    }

    #[test]
    fn save_system_preserves_sidebar_order_across_database_reopen() {
        let temp = tempfile::tempdir().expect("temp database");
        let path = temp.path().join("settings.sqlite");
        let order = json!(["/workspace/b", "/workspace/a"]);
        let pins = json!([
            "workspace:/workspace/a",
            "conversation:one",
            "workspace:/workspace/b"
        ]);
        {
            let mut conn = Connection::open(&path).expect("open database");
            initialize_schema(&conn).expect("initialize database");
            save_system_with_default_workdir(
                &mut conn,
                json!({
                    "workspaceProjectOrder": order,
                    "sidebarPinnedOrder": pins,
                }),
                "/workspace/default",
            )
            .expect("save sidebar preferences");
        }
        let mut conn = Connection::open(&path).expect("reopen database");
        let mut loaded =
            load_system_with_defaults(&conn, "/workspace/default").expect("load preferences");
        assert_eq!(loaded.get(SYSTEM_WORKSPACE_PROJECT_ORDER_KEY), Some(&order));
        assert_eq!(loaded.get(SYSTEM_SIDEBAR_PINNED_ORDER_KEY), Some(&pins));
        loaded["executionMode"] = json!("tools");
        save_system_with_default_workdir(&mut conn, loaded, "/workspace/default")
            .expect("save unrelated setting");
        let loaded = load_system(&conn)
            .expect("reload preferences")
            .expect("system settings");
        assert_eq!(loaded.get(SYSTEM_SIDEBAR_PINNED_ORDER_KEY), Some(&pins));
        assert_eq!(loaded.get(SYSTEM_WORKSPACE_PROJECT_ORDER_KEY), Some(&order));
    }

    #[test]
    fn initialize_schema_creates_all_tables() {
        let conn = open_memory_db();

        for table in [
            PROVIDER_SETTINGS_TABLE,
            SYSTEM_SETTINGS_TABLE,
            MCP_SETTINGS_TABLE,
            AGENT_PROMPT_TEMPLATES_TABLE,
            SSH_SETTINGS_TABLE,
            REMOTE_SETTINGS_TABLE,
            MEMORY_SETTINGS_TABLE,
            MODEL_FAILOVER_SETTINGS_TABLE,
            SSH_PROJECT_HOST_ASSOCIATIONS_TABLE,
            SSH_KNOWN_HOSTS_TABLE,
            BACKUP_SYNC_SETTINGS_TABLE,
        ] {
            let exists = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get::<_, i64>(0),
                )
                .expect("query sqlite_master");
            assert_eq!(exists, 1, "table {table} should exist");
        }
    }

    #[test]
    fn ssh_patch_conflict_gateway_message_is_a_stable_code() {
        assert_eq!(
            SshPatchConflictCode::SettingsChanged.gateway_message(),
            "settings_changed"
        );
    }

    #[test]
    fn initialize_schema_creates_columnar_ssh_settings_table() {
        let conn = open_memory_db();
        let columns = table_columns(&conn, SSH_SETTINGS_TABLE);

        for column in [
            "host_id",
            "name",
            "description",
            "host",
            "port",
            "username",
            "auth_type",
            "password",
            "password_configured",
            "private_key",
            "private_key_path",
            "private_key_configured",
            "private_key_passphrase",
            "private_key_passphrase_configured",
            "proxy_json",
            "sort_index",
            "updated_at",
        ] {
            assert!(
                columns.iter().any(|item| item == column),
                "{SSH_SETTINGS_TABLE}.{column} should exist"
            );
        }
        assert!(
            !columns.iter().any(|item| item == "payload_json"),
            "{SSH_SETTINGS_TABLE}.payload_json should not exist"
        );
    }

    #[test]
    fn save_memory_persists_default_payload_and_sync_snapshot() {
        let mut conn = open_memory_db();
        let payload = json!({
            "organizerModel": {
                "customProviderId": "provider-a",
                "model": "gpt-5"
            },
            "summaryModel": {
                "customProviderId": "provider-a",
                "model": "gpt-5.4"
            }
        });

        save_memory(&mut conn, payload.clone()).expect("save memory settings");

        assert_eq!(
            load_memory(&conn).expect("load memory settings"),
            Some(payload.clone())
        );
        let snapshot =
            load_gateway_settings_sync_snapshot(&conn).expect("load gateway settings snapshot");
        assert_eq!(snapshot["memory"], payload);
    }

    #[test]
    fn schema_init_drops_the_dead_local_memory_organizer_schedule() {
        let conn = open_memory_db();
        let stored = json!({
            "organizerModel": { "customProviderId": "provider-a", "model": "gpt-5" },
            "summaryModel": { "customProviderId": "provider-a", "model": "gpt-5.4" },
            "organizerEnabled": true,
            "organizerSchedule": { "frequency": "daily", "timeLocal": "03:00", "timezone": "UTC" },
            "organizerScope": "all",
            "organizerMode": "standard",
            "organizerLastRunAt": 1,
            "organizerNextRunAt": 2
        });
        conn.execute(
            &format!(
                "INSERT INTO {MEMORY_SETTINGS_TABLE} (config_id, payload_json, updated_at) VALUES ('default', ?1, 0)"
            ),
            params![stored.to_string()],
        )
        .expect("insert legacy memory settings");

        initialize_schema(&conn).expect("re-run schema init");
        initialize_schema(&conn).expect("schema init is idempotent");

        assert_eq!(
            load_memory(&conn).expect("load memory settings"),
            Some(json!({
                "organizerModel": { "customProviderId": "provider-a", "model": "gpt-5" },
                "summaryModel": { "customProviderId": "provider-a", "model": "gpt-5.4" }
            }))
        );
    }

    #[test]
    fn normalize_remote_settings_repairs_single_slash_gateway_url() {
        let normalized = normalize_remote_settings_payload(RemoteSettingsPayload {
            enabled: true,
            gateway_url: " https:/agent.cnweb.org/ ".to_string(),
            gateway_port: 443,
            token: " agent-token-dev ".to_string(),
            agent_id: " mac-mini ".to_string(),
            auto_reconnect: true,
            heartbeat_interval: 30,
            enable_web_terminal: false,
            enable_web_ssh_terminal: false,
            enable_web_git: false,
            enable_web_tunnels: false,
            ..RemoteSettingsPayload::default()
        });

        assert_eq!(normalized.gateway_url, "https://agent.cnweb.org");
        assert_eq!(normalized.token, "agent-token-dev");
        assert_eq!(normalized.agent_id, "mac-mini");
    }

    #[test]
    fn ensure_remote_agent_id_migrates_legacy_grpc_port() {
        let mut conn = open_memory_db();
        let legacy = json!({
            "enabled": true,
            "gatewayUrl": "https://gateway.example.com",
            "grpcPort": 8443,
            "token": "gateway-token"
        });
        conn.execute(
            &format!(
                "INSERT INTO {REMOTE_SETTINGS_TABLE} (config_id, payload_json, updated_at)
                 VALUES ('default', ?1, ?2)"
            ),
            params![legacy.to_string(), now_ms()],
        )
        .expect("seed legacy remote settings");

        ensure_remote_agent_id(&mut conn).expect("migrate legacy remote settings");
        let migrated = load_remote_settings(&conn).expect("load migrated remote settings");
        let stored_json = conn
            .query_row(
                &format!(
                    "SELECT payload_json FROM {REMOTE_SETTINGS_TABLE} WHERE config_id = 'default'"
                ),
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("load stored remote payload");

        assert_eq!(migrated.gateway_port, 8443);
        assert!(is_generated_agent_id(&migrated.agent_id));
        assert!(stored_json.contains("\"gatewayPort\":8443"));
        assert!(!stored_json.contains("grpcPort"));
    }

    #[test]
    fn ensure_remote_agent_id_generates_once_and_survives_reopen() {
        let mut conn = open_memory_db();

        let first = ensure_remote_agent_id(&mut conn).expect("generate Agent ID");
        let second = ensure_remote_agent_id(&mut conn).expect("reload Agent ID");
        let stored = load_remote_settings(&conn).expect("load remote settings");

        assert!(is_generated_agent_id(&first), "generated id = {first}");
        assert_eq!(second, first);
        assert_eq!(stored.agent_id, first);
    }

    #[test]
    fn ensure_remote_agent_id_replaces_manual_id_and_preserves_remote_settings() {
        let mut conn = open_memory_db();
        persist_remote_settings(
            &conn,
            &RemoteSettingsPayload {
                enabled: true,
                gateway_url: "https://gateway.example.com".to_string(),
                gateway_port: 8443,
                token: "gateway-token".to_string(),
                agent_id: "liveagent".to_string(),
                auto_reconnect: false,
                heartbeat_interval: 45,
                enable_web_terminal: true,
                enable_web_ssh_terminal: true,
                enable_web_git: true,
                enable_web_tunnels: true,
                ..RemoteSettingsPayload::default()
            },
        )
        .expect("seed manual Agent ID");

        let generated = ensure_remote_agent_id(&mut conn).expect("replace manual Agent ID");
        let stored = load_remote_settings(&conn).expect("load remote settings");

        assert!(is_generated_agent_id(&generated));
        assert_eq!(stored.agent_id, generated);
        assert_eq!(stored.gateway_url, "https://gateway.example.com");
        assert_eq!(stored.gateway_port, 8443);
        assert_eq!(stored.token, "gateway-token");
        assert!(!stored.auto_reconnect);
        assert_eq!(stored.heartbeat_interval, 45);
        assert!(stored.enable_web_terminal);
        assert!(stored.enable_web_ssh_terminal);
        assert!(stored.enable_web_git);
        assert!(stored.enable_web_tunnels);
    }

    #[test]
    fn save_remote_cannot_override_persisted_agent_id() {
        let mut conn = open_memory_db();
        let generated = ensure_remote_agent_id(&mut conn).expect("generate Agent ID");

        let saved = save_remote(
            &mut conn,
            json!({
                "enabled": true,
                "gatewayUrl": "https://gateway.example.com",
                "gatewayPort": 443,
                "token": "gateway-token",
                "agentId": "attacker-controlled",
                "autoReconnect": true,
                "heartbeatInterval": 30
            }),
        )
        .expect("save remote settings");
        let stored = load_remote_settings(&conn).expect("load remote settings");

        assert_eq!(saved.agent_id, generated);
        assert_eq!(stored.agent_id, generated);
    }

    #[test]
    fn independent_installations_generate_different_agent_ids() {
        let mut first = open_memory_db();
        let mut second = open_memory_db();

        let first_id = ensure_remote_agent_id(&mut first).expect("generate first Agent ID");
        let second_id = ensure_remote_agent_id(&mut second).expect("generate second Agent ID");

        assert_ne!(first_id, second_id);
    }

    #[test]
    fn concurrent_initialization_keeps_one_agent_id() {
        let dir = tempfile::tempdir().expect("create temp directory");
        let path = dir.path().join("settings.sqlite");
        let conn = Connection::open(&path).expect("open shared settings db");
        initialize_schema(&conn).expect("initialize schema");
        drop(conn);

        let workers = (0..8)
            .map(|_| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let mut conn = Connection::open(path).expect("open shared settings db");
                    conn.busy_timeout(Duration::from_secs(5))
                        .expect("configure busy timeout");
                    ensure_remote_agent_id(&mut conn).expect("initialize Agent ID")
                })
            })
            .collect::<Vec<_>>();
        let ids = workers
            .into_iter()
            .map(|worker| worker.join().expect("join Agent ID initializer"))
            .collect::<Vec<_>>();

        assert!(ids.iter().all(|agent_id| agent_id == &ids[0]));
        assert!(is_generated_agent_id(&ids[0]));
    }

    #[test]
    fn save_providers_persists_one_row_per_provider_and_preserves_order() {
        let mut conn = open_memory_db();
        save_providers(
            &mut conn,
            json!([
                { "id": "provider-b", "name": "B" },
                { "id": "provider-a", "name": "A" }
            ]),
        )
        .expect("save providers");

        let row_count = conn
            .query_row("SELECT COUNT(*) FROM provider_settings", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count provider rows");
        let loaded = load_providers(&conn).expect("load providers");

        assert_eq!(row_count, 2);
        assert_eq!(
            loaded,
            Some(json!([
                { "id": "provider-b", "name": "B" },
                { "id": "provider-a", "name": "A" }
            ]))
        );
    }

    #[test]
    fn gateway_settings_snapshot_redacts_provider_api_keys() {
        let mut conn = open_memory_db();
        save_providers(
            &mut conn,
            json!([
                {
                    "id": "provider-a",
                    "name": "A",
                    "apiKey": "secret-key",
                    "usageQuery": {
                        "apiKey": "usage-key",
                        "accessToken": "usage-token",
                        "secretAccessKey": "usage-secret"
                    },
                    "apiKeyConfigured": false
                },
                {
                    "id": "provider-b",
                    "name": "B",
                    "apiKey": "",
                    "apiKeyConfigured": true
                }
            ]),
        )
        .expect("save providers");

        let snapshot =
            load_gateway_settings_sync_snapshot(&conn).expect("load gateway settings snapshot");
        assert_eq!(snapshot["customProviders"][0]["apiKey"], Value::Null);
        assert_eq!(snapshot["customProviders"][0]["apiKeyConfigured"], true);
        assert_eq!(snapshot["customProviders"][0]["usageQuery"]["apiKey"], Value::Null);
        assert_eq!(
            snapshot["customProviders"][0]["usageQuery"]["apiKeyConfigured"],
            true
        );
        assert_eq!(snapshot["customProviders"][0]["usageQuery"]["accessToken"], Value::Null);
        assert_eq!(
            snapshot["customProviders"][0]["usageQuery"]["accessTokenConfigured"],
            true
        );
        assert_eq!(
            snapshot["customProviders"][0]["usageQuery"]["secretAccessKey"],
            Value::Null
        );
        assert_eq!(
            snapshot["customProviders"][0]["usageQuery"]["secretAccessKeyConfigured"],
            true
        );
        assert_eq!(snapshot["customProviders"][1]["apiKey"], Value::Null);
        assert_eq!(snapshot["customProviders"][1]["apiKeyConfigured"], true);
    }

    #[test]
    fn gateway_settings_payload_removes_usage_query_secret_sidecar() {
        let redacted = redact_gateway_settings_sync_payload(json!({
            "providerUsageQuerySecretUpdates": {
                "provider-a": {
                    "accessToken": "usage-token",
                    "secretAccessKey": "usage-secret"
                }
            }
        }))
        .expect("redact gateway settings payload");

        assert_eq!(redacted.get("providerUsageQuerySecretUpdates"), None);
    }

    #[test]
    fn gateway_settings_snapshot_redacts_stt_and_private_sync_field() {
        let mut conn = open_memory_db();
        save_stt(
            &mut conn,
            json!({
                "provider": "aliyun_dashscope",
                "providers": {
                    "aliyun_dashscope": {
                        "id": "aliyun_dashscope",
                        "websocketUrl": "wss://example.com/stt",
                        "model": "paraformer-realtime-v2",
                        "apiKey": "desktop-only-secret"
                    }
                }
            }),
        )
        .expect("save STT settings");

        let snapshot =
            load_gateway_settings_sync_snapshot(&conn).expect("load gateway settings snapshot");
        assert_eq!(snapshot["stt"]["provider"], "aliyun_dashscope");
        assert_eq!(
            snapshot["stt"]["providers"]["aliyun_dashscope"]["configured"],
            true
        );
        assert_eq!(
            snapshot["stt"]["providers"]["aliyun_dashscope"]["apiKey"],
            ""
        );
        assert_eq!(
            load_stt_secret(&conn, "aliyun_dashscope", "apiKey")
                .expect("reveal local STT secret"),
            "desktop-only-secret"
        );
        assert!(load_stt_secret(&conn, "aliyun_dashscope", "websocketUrl").is_err());

        let redacted = redact_gateway_settings_sync_payload(json!({
            "sttSecretSync": {
                "providers": {"aliyun_dashscope": {"apiKey": "must-not-leak"}}
            },
            "stt": load_stt_raw(&conn).expect("load raw STT settings")
        }))
        .expect("redact gateway STT payload");
        assert_eq!(redacted.get(STT_SECRET_SYNC_FIELD), None);
        assert_eq!(
            redacted["stt"]["providers"]["aliyun_dashscope"]["apiKey"],
            ""
        );
    }

    #[test]
    fn save_ssh_persists_hosts_and_redacts_sync_snapshot() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [
                    {
                        "id": "prod",
                        "name": "Production",
                        "description": "Primary production host",
                        "host": "prod.example.com",
                        "port": "2222",
                        "username": "deploy",
                        "authType": "privateKey",
                        "password": "ssh-password",
                        "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
                        "privateKeyPath": "~/.ssh/id_ed25519",
                        "privateKeyPassphrase": "key-passphrase",
                        "proxy": {
                            "type": "http",
                            "url": "http://127.0.0.1",
                            "port": "1080",
                            "username": "proxy-user",
                            "password": "proxy-password",
                            "useSystemProxy": true
                        }
                    },
                    {
                        "id": "staging",
                        "name": "Staging",
                        "description": "",
                        "host": "staging.example.com",
                        "username": "ubuntu",
                        "authType": "password",
                        "passwordConfigured": true
                    }
                ],
                "projectHostAssociations": {
                    " /repo/project ": ["prod", "missing", "prod", "staging"],
                    "empty": ["missing"],
                    "  ": ["prod"]
                }
            }),
        )
        .expect("save ssh settings");

        let row_count = conn
            .query_row("SELECT COUNT(*) FROM ssh_settings", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count ssh rows");
        let loaded = load_ssh(&conn).expect("load ssh settings");

        assert_eq!(row_count, 2);
        let stored = conn
            .query_row(
                "
                SELECT name, host, port, auth_type, private_key, private_key_passphrase, proxy_json
                FROM ssh_settings
                WHERE host_id = 'prod'
                ",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .expect("load stored ssh columns");
        assert_eq!(stored.0, "Production");
        assert_eq!(stored.1, "prod.example.com");
        assert_eq!(stored.2, 2222);
        assert_eq!(stored.3, "privateKey");
        assert_eq!(
            stored.4,
            "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----"
        );
        assert_eq!(stored.5, "key-passphrase");
        assert_eq!(
            parse_json(&stored.6, SSH_SETTINGS_TABLE).expect("parse proxy json"),
            json!({
                "type": "http",
                "url": "http://127.0.0.1",
                "port": 1080,
                "username": "proxy-user",
                "password": "proxy-password",
                "passwordConfigured": true,
                "useSystemProxy": true
            })
        );
        assert_eq!(
            loaded,
            Some(json!({
                "hosts": [
                    {
                        "id": "prod",
                        "name": "Production",
                        "description": "Primary production host",
                        "host": "prod.example.com",
                        "port": 2222,
                        "username": "deploy",
                        "authType": "privateKey",
                        "password": "ssh-password",
                        "passwordConfigured": true,
                        "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
                        "privateKeyPath": "~/.ssh/id_ed25519",
                        "privateKeyConfigured": true,
                        "privateKeyPassphrase": "key-passphrase",
                        "privateKeyPassphraseConfigured": true,
                        "proxy": {
                            "type": "http",
                            "url": "http://127.0.0.1",
                            "port": 1080,
                            "username": "proxy-user",
                            "password": "proxy-password",
                            "passwordConfigured": true,
                            "useSystemProxy": true
                        }
                    },
                    {
                        "id": "staging",
                        "name": "Staging",
                        "description": "",
                        "host": "staging.example.com",
                        "port": 22,
                        "username": "ubuntu",
                        "authType": "password",
                        "password": "",
                        "passwordConfigured": true,
                        "privateKey": "",
                        "privateKeyPath": "",
                        "privateKeyConfigured": false,
                        "privateKeyPassphrase": "",
                        "privateKeyPassphraseConfigured": false,
                        "proxy": {
                            "type": "socks5",
                            "url": "",
                            "port": 0,
                            "username": "",
                            "password": "",
                            "passwordConfigured": false,
                            "useSystemProxy": false
                        }
                    }
                ],
                "projectHostAssociations": {
                    "/repo/project": ["prod", "staging"]
                }
            }))
        );

        let snapshot =
            load_gateway_settings_sync_snapshot(&conn).expect("load gateway settings snapshot");
        assert_eq!(snapshot["ssh"]["hosts"][0]["password"], Value::Null);
        assert_eq!(snapshot["ssh"]["hosts"][0]["privateKey"], Value::Null);
        assert_eq!(
            snapshot["ssh"]["hosts"][0]["privateKeyPassphrase"],
            Value::Null
        );
        assert_eq!(snapshot["ssh"]["hosts"][0]["passwordConfigured"], true);
        assert_eq!(snapshot["ssh"]["hosts"][0]["privateKeyConfigured"], true);
        assert_eq!(
            snapshot["ssh"]["hosts"][0]["privateKeyPassphraseConfigured"],
            true
        );
        assert_eq!(
            snapshot["ssh"]["hosts"][0]["proxy"]["password"],
            Value::Null
        );
        assert_eq!(
            snapshot["ssh"]["hosts"][0]["proxy"]["passwordConfigured"],
            true
        );
        assert_eq!(snapshot["ssh"]["hosts"][1]["password"], Value::Null);
        assert_eq!(snapshot["ssh"]["hosts"][1]["privateKey"], Value::Null);
        assert_eq!(
            snapshot["ssh"]["hosts"][1]["privateKeyPassphrase"],
            Value::Null
        );
        assert_eq!(snapshot["ssh"]["hosts"][1]["passwordConfigured"], true);
        assert_eq!(
            snapshot["ssh"]["hosts"][1]["privateKeyPassphraseConfigured"],
            false
        );
        assert_eq!(
            snapshot["ssh"]["hosts"][1]["proxy"]["password"],
            Value::Null
        );
        assert_eq!(
            snapshot["ssh"]["hosts"][1]["proxy"]["passwordConfigured"],
            false
        );
        assert_eq!(
            snapshot["ssh"]["projectHostAssociations"],
            json!({
                "/repo/project": ["prod", "staging"]
            })
        );
    }

    #[test]
    fn save_ssh_keyboard_interactive_host_clears_credential_secret_state() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [
                    {
                        "id": "kbi-prod",
                        "name": "Keyboard Interactive Production",
                        "host": "prod.example.com",
                        "username": "deploy",
                        "authType": "keyboardInteractive",
                        "password": "old-password",
                        "passwordConfigured": true,
                        "privateKey": "old-key",
                        "privateKeyPath": "~/.ssh/id_rsa",
                        "privateKeyConfigured": true,
                        "privateKeyPassphrase": "old-passphrase",
                        "privateKeyPassphraseConfigured": true,
                        "proxy": {
                            "type": "http",
                            "url": "http://127.0.0.1",
                            "port": 8080,
                            "username": "proxy-user",
                            "password": "proxy-password"
                        }
                    }
                ]
            }),
        )
        .expect("save keyboard-interactive ssh settings");

        let loaded = load_ssh(&conn)
            .expect("load ssh settings")
            .expect("ssh settings should exist");
        let host = &loaded["hosts"][0];
        assert_eq!(host["authType"], "keyboardInteractive");
        assert_eq!(host["password"], "");
        assert_eq!(host["passwordConfigured"], false);
        assert_eq!(host["privateKey"], "");
        assert_eq!(host["privateKeyPath"], "");
        assert_eq!(host["privateKeyConfigured"], false);
        assert_eq!(host["privateKeyPassphrase"], "");
        assert_eq!(host["privateKeyPassphraseConfigured"], false);
        assert_eq!(host["proxy"]["passwordConfigured"], true);

        let snapshot =
            load_gateway_settings_sync_snapshot(&conn).expect("load gateway settings snapshot");
        assert_eq!(snapshot["ssh"]["hosts"][0]["password"], Value::Null);
        assert_eq!(snapshot["ssh"]["hosts"][0]["passwordConfigured"], false);
        assert_eq!(snapshot["ssh"]["hosts"][0]["privateKeyConfigured"], false);
        assert_eq!(
            snapshot["ssh"]["hosts"][0]["privateKeyPassphraseConfigured"],
            false
        );
    }

    #[test]
    fn initialize_schema_migrates_legacy_agent_auth_to_password() {
        let conn = open_memory_db();
        conn.execute(
            "
            INSERT INTO ssh_settings (
                host_id, name, description, host, port, username, auth_type,
                password, password_configured, private_key, private_key_path,
                private_key_configured, private_key_passphrase,
                private_key_passphrase_configured, proxy_json, sort_index, updated_at
            )
            VALUES ('legacy', 'Legacy', '', 'legacy.example.com', 22, 'deploy', 'agent',
                '', 0, '', '', 0, '', 0, '{}', 0, 0)
            ",
            [],
        )
        .expect("insert legacy agent host");

        initialize_schema(&conn).expect("re-run schema initialization");

        let auth_type: String = conn
            .query_row(
                "SELECT auth_type FROM ssh_settings WHERE host_id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated auth type");
        assert_eq!(auth_type, "password");
    }

    #[test]
    fn ssh_patch_delete_preserves_concurrent_hosts_and_associations() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [
                    {
                        "id": "prod",
                        "name": "Prod",
                        "host": "prod.example.com",
                        "username": "deploy",
                        "authType": "password"
                    },
                    {
                        "id": "staging",
                        "name": "Staging",
                        "host": "staging.example.com",
                        "username": "deploy",
                        "authType": "keyboardInteractive"
                    }
                ],
                "projectHostAssociations": {
                    "/repo": ["prod", "staging"]
                }
            }),
        )
        .expect("save ssh");

        let response = apply_ssh_patch_with_conn(
            &mut conn,
            json!({
                "sshPatch": {
                    "hostChanges": [{
                        "id": "prod",
                        "before": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password"
                        },
                        "after": null
                    }],
                    "projectAssociationChanges": [{
                        "pathKey": "/repo",
                        "before": ["prod"],
                        "after": []
                    }]
                }
            }),
        )
        .expect("apply patch");

        assert_eq!(response.conflict, None);
        assert_eq!(response.ssh["hosts"][0]["id"], "staging");
        assert_eq!(
            response.ssh["projectHostAssociations"],
            json!({
                "/repo": ["staging"]
            })
        );
    }

    #[test]
    fn ssh_patch_rejects_same_field_conflict() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [{
                    "id": "prod",
                    "name": "Prod New",
                    "host": "prod.example.com",
                    "username": "deploy",
                    "authType": "password"
                }]
            }),
        )
        .expect("save ssh");

        let response = apply_ssh_patch_with_conn(
            &mut conn,
            json!({
                "sshPatch": {
                    "hostChanges": [{
                        "id": "prod",
                        "before": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password"
                        },
                        "after": {
                            "id": "prod",
                            "name": "Prod Web",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password"
                        }
                    }]
                }
            }),
        )
        .expect("apply patch");

        assert_eq!(
            response.conflict,
            Some(SshPatchConflictCode::SettingsChanged)
        );
        assert_eq!(response.ssh["hosts"][0]["name"], "Prod New");
    }

    #[test]
    fn ssh_patch_merges_different_host_fields() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [{
                    "id": "prod",
                    "name": "Prod Desktop",
                    "host": "prod.example.com",
                    "username": "deploy",
                    "authType": "password"
                }]
            }),
        )
        .expect("save ssh");

        let response = apply_ssh_patch_with_conn(
            &mut conn,
            json!({
                "sshPatch": {
                    "hostChanges": [{
                        "id": "prod",
                        "before": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password"
                        },
                        "after": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.internal",
                            "username": "deploy",
                            "authType": "password"
                        }
                    }]
                }
            }),
        )
        .expect("apply patch");

        assert_eq!(response.conflict, None);
        assert_eq!(response.ssh["hosts"][0]["name"], "Prod Desktop");
        assert_eq!(response.ssh["hosts"][0]["host"], "prod.internal");
    }

    #[test]
    fn ssh_patch_rejects_auth_type_secret_conflict() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [{
                    "id": "prod",
                    "name": "Prod",
                    "host": "prod.example.com",
                    "username": "deploy",
                    "authType": "keyboardInteractive"
                }]
            }),
        )
        .expect("save ssh");

        let response = apply_ssh_patch_with_conn(
            &mut conn,
            json!({
                "sshPatch": {},
                "sshSecretUpdates": {
                    "prod": {
                        "password": "secret"
                    }
                }
            }),
        )
        .expect("apply patch");

        assert_eq!(
            response.conflict,
            Some(SshPatchConflictCode::SettingsChanged)
        );
    }

    #[test]
    fn ssh_patch_clears_empty_secret_updates() {
        let mut conn = open_memory_db();
        save_ssh(
            &mut conn,
            json!({
                "hosts": [{
                    "id": "prod",
                    "name": "Prod",
                    "host": "prod.example.com",
                    "username": "deploy",
                    "authType": "password",
                    "password": "old-password"
                }]
            }),
        )
        .expect("save ssh");

        let response = apply_ssh_patch_with_conn(
            &mut conn,
            json!({
                "sshPatch": {
                    "hostChanges": [{
                        "id": "prod",
                        "before": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password",
                            "passwordConfigured": true
                        },
                        "after": {
                            "id": "prod",
                            "name": "Prod",
                            "host": "prod.example.com",
                            "username": "deploy",
                            "authType": "password",
                            "passwordConfigured": false
                        }
                    }]
                },
                "sshSecretUpdates": {
                    "prod": {
                        "password": ""
                    }
                }
            }),
        )
        .expect("apply patch");

        assert_eq!(response.conflict, None);
        assert_eq!(response.ssh["hosts"][0]["password"], "");
        assert_eq!(response.ssh["hosts"][0]["passwordConfigured"], false);
    }

    #[test]
    fn ssh_known_hosts_tracks_unknown_known_and_changed_keys() {
        let conn = open_memory_db();
        let key = RuntimeSshKnownHostKey {
            host: "example.com".to_string(),
            port: 22,
            key_type: "ssh-ed25519".to_string(),
            key_base64: "known-key".to_string(),
            fingerprint_sha256: "SHA256:known".to_string(),
        };

        assert_eq!(
            check_runtime_ssh_known_host_with_conn(&conn, &key).expect("check unknown host key"),
            RuntimeSshKnownHostStatus::Unknown
        );

        trust_runtime_ssh_known_host_with_conn(&conn, &key).expect("trust host key");
        assert_eq!(
            check_runtime_ssh_known_host_with_conn(&conn, &key).expect("check trusted host key"),
            RuntimeSshKnownHostStatus::Known
        );

        let changed = RuntimeSshKnownHostKey {
            key_base64: "changed-key".to_string(),
            fingerprint_sha256: "SHA256:changed".to_string(),
            ..key.clone()
        };
        assert_eq!(
            check_runtime_ssh_known_host_with_conn(&conn, &changed)
                .expect("check changed host key"),
            RuntimeSshKnownHostStatus::Changed {
                stored_fingerprint: "SHA256:known".to_string()
            }
        );

        assert_eq!(
            reset_runtime_ssh_known_host_with_conn(&conn, "example.com", 22)
                .expect("reset host key"),
            1
        );
        assert_eq!(
            check_runtime_ssh_known_host_with_conn(&conn, &key).expect("check reset host key"),
            RuntimeSshKnownHostStatus::Unknown
        );
        assert_eq!(
            reset_runtime_ssh_known_host_with_conn(&conn, "example.com", 22)
                .expect("reset missing host key"),
            0
        );
    }

    #[test]
    fn save_mcp_persists_one_row_per_server_and_restores_selection() {
        let mut conn = open_memory_db();
        save_mcp(
            &mut conn,
            json!({
                "servers": [
                    { "id": "alpha", "enabled": true, "transport": "stdio" },
                    { "id": "beta", "enabled": false, "transport": "http" }
                ],
                "selected": ["beta"]
            }),
        )
        .expect("save mcp");

        let row_count = conn
            .query_row("SELECT COUNT(*) FROM mcp_settings", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count mcp rows");
        let selected_flag = conn
            .query_row(
                "SELECT payload_json FROM mcp_settings WHERE server_id = 'beta'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("query beta payload");
        let loaded = load_mcp(&conn).expect("load mcp");

        assert_eq!(row_count, 2);
        assert!(
            selected_flag.contains("\"selected\":true"),
            "selected flag should be stored inline"
        );
        assert_eq!(
            loaded,
            Some(json!({
                "servers": [
                    { "id": "alpha", "enabled": true, "transport": "stdio" },
                    { "id": "beta", "enabled": false, "transport": "http" }
                ],
                "selected": ["beta"]
            }))
        );
    }

    #[test]
    fn save_agents_persists_one_row_per_template_and_restores_columns() {
        let mut conn = open_memory_db();
        save_agents(
            &mut conn,
            json!([
                {
                    "id": "reviewer",
                    "name": "代码审查",
                    "description": "用于审查 PR 和补测试缺口",
                    "prompt": "你是一个严格的代码审查助手。",
                    "enabled": true
                },
                {
                    "id": "planner",
                    "name": "任务规划",
                    "description": "",
                    "prompt": "先拆任务，再执行。",
                    "enabled": false
                }
            ]),
        )
        .expect("save agents");

        let row_count = conn
            .query_row("SELECT COUNT(*) FROM agent_prompt_templates", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count agent rows");
        let stored_enabled = conn
            .query_row(
                "SELECT enabled FROM agent_prompt_templates WHERE template_id = 'reviewer'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("query reviewer enabled");
        let loaded = load_agents(&conn).expect("load agents");

        assert_eq!(row_count, 2);
        assert_eq!(stored_enabled, 1);
        assert_eq!(
            loaded,
            Some(json!([
                {
                    "id": "reviewer",
                    "name": "代码审查",
                    "description": "用于审查 PR 和补测试缺口",
                    "prompt": "你是一个严格的代码审查助手。",
                    "enabled": true
                },
                {
                    "id": "planner",
                    "name": "任务规划",
                    "description": "",
                    "prompt": "先拆任务，再执行。",
                    "enabled": false
                }
            ]))
        );
    }

    // 归一后的 systemProxy 默认值（save/load 全量断言共用）。
    fn default_system_proxy_json() -> Value {
        json!({
            "enabled": false,
            "type": "http",
            "host": "",
            "port": 0,
            "username": "",
            "password": "",
            "passwordConfigured": false
        })
    }

    #[test]
    fn save_system_persists_project_setting_rows() {
        let mut conn = open_memory_db();
        save_system(
            &mut conn,
            json!({
                "executionMode": "tools",
                "workdir": "E:/Code/test_directory/003",
                "toolPolicies": { "Bash": "ask", "server:docs-mcp": "deny" }
            }),
        )
        .expect("save system");

        let row_count = conn
            .query_row("SELECT COUNT(*) FROM system_settings", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count system rows");
        let keys = {
            let mut stmt = conn
                .prepare("SELECT setting_key FROM system_settings ORDER BY setting_key ASC")
                .expect("prepare key query");
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query keys");
            rows.into_iter()
                .map(|row| row.expect("key row"))
                .collect::<Vec<_>>()
        };
        let loaded = load_system(&conn).expect("load system");

        assert_eq!(row_count, 15);
        assert_eq!(
            keys,
            vec![
                SYSTEM_ACTIVE_WORKSPACE_PROJECT_ID_KEY.to_string(),
                SYSTEM_ARCHIVED_WORKSPACE_PROJECT_PATHS_KEY.to_string(),
                SYSTEM_BROWSER_AUTOMATION_MODE_KEY.to_string(),
                SYSTEM_COMMAND_SAFETY_MODE_KEY.to_string(),
                SYSTEM_CUA_ALLOW_SELF_TARGETING_KEY.to_string(),
                SYSTEM_DEFAULT_TIME_ZONE_KEY.to_string(),
                SYSTEM_EXECUTION_MODE_KEY.to_string(),
                SYSTEM_HIDDEN_WORKSPACE_PROJECT_PATHS_KEY.to_string(),
                SYSTEM_MISSING_WORKSPACE_PROJECT_PATHS_KEY.to_string(),
                SYSTEM_SYSTEM_PROXY_KEY.to_string(),
                SYSTEM_TOOL_POLICIES_KEY.to_string(),
                SYSTEM_WORKDIR_KEY.to_string(),
                SYSTEM_WORKSPACE_PROJECT_GROUPS_KEY.to_string(),
                SYSTEM_WORKSPACE_PROJECTS_KEY.to_string(),
                SYSTEM_WORKSPACE_RESOURCE_SETTINGS_KEY.to_string(),
            ]
        );
        assert_eq!(
            loaded,
            Some(json!({
                "activeWorkspaceProjectId": "",
                "cuaAllowSelfTargeting": false,
                "executionMode": "tools",
                "hiddenWorkspaceProjectPaths": [],
                "missingWorkspaceProjectPaths": [],
                "archivedWorkspaceProjectPaths": [],
                "workspaceResourceSettings": {},
                "commandSafetyMode": "always",
                "browserAutomationMode": "auto",
                "defaultTimeZone": "",
                "systemProxy": default_system_proxy_json(),
                "workdir": "E:/Code/test_directory/003",
                "toolPolicies": { "Bash": "ask", "server:docs-mcp": "deny" },
                "workspaceProjectGroups": null,
                "workspaceProjects": []
            }))
        );
    }

    #[test]
    fn save_system_round_trips_archived_workspace_project_paths() {
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "workdir": "/tmp/liveagent-default-project",
                "archivedWorkspaceProjectPaths": [
                    " /tmp/project-a ",
                    "/tmp/project-a",
                    "",
                    42
                ]
            }),
            "/tmp/liveagent-default-project",
        )
        .expect("save system");

        let loaded = load_system(&conn)
            .expect("load system")
            .expect("system settings");
        assert_eq!(
            loaded.get(SYSTEM_ARCHIVED_WORKSPACE_PROJECT_PATHS_KEY),
            Some(&json!(["/tmp/project-a"]))
        );
    }

    #[test]
    fn save_system_round_trips_workspace_project_groups() {
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "workdir": "/tmp/liveagent-default-project",
                "workspaceProjectGroups": [
                    {
                        "id": "g1",
                        "name": "LiveAgent",
                        "projectPaths": ["/tmp/repo", "/tmp/wt"],
                        "sourceProjectPath": "/tmp/repo",
                        "collapsed": true,
                        "createdAt": 100,
                        "updatedAt": 100
                    }
                ]
            }),
            "/tmp/liveagent-default-project",
        )
        .expect("save system");

        let loaded = load_system(&conn)
            .expect("load system")
            .expect("system settings");
        assert_eq!(
            loaded.get(SYSTEM_WORKSPACE_PROJECT_GROUPS_KEY),
            Some(&json!([
                {
                    "id": "g1",
                    "name": "LiveAgent",
                    "projectPaths": ["/tmp/repo", "/tmp/wt"],
                    "sourceProjectPath": "/tmp/repo",
                    "collapsed": true,
                    "createdAt": 100,
                    "updatedAt": 100
                }
            ]))
        );
    }

    #[test]
    fn save_system_normalizes_workspace_resource_settings() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_millis() as u64;
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "workdir": "/tmp/liveagent-default-project",
                "workspaceResourceSettings": {
                    "/tmp/project-a/": {
                        "mode": "custom",
                        "skillNames": ["review", "review", ""],
                        "mcpServerIds": ["github", "github", 42],
                        "projectPrompt": " Review this project. ",
                        "projectPromptStrategy": "replace",
                        "stateVersion": 3,
                        "writerId": " client-a ",
                        "updatedAt": 100
                    },
                    "/tmp/project-b": {
                        "mode": "inherit",
                        "skillNames": ["ignored"],
                        "mcpServerIds": ["ignored"],
                        "projectPrompt": 42,
                        "projectPromptStrategy": "invalid",
                        "stateVersion": 4,
                        "writerId": "client-b",
                        "updatedAt": now
                    }
                }
            }),
            "/tmp/liveagent-default-project",
        )
        .expect("save system");

        let loaded = load_system(&conn)
            .expect("load system")
            .expect("system settings");
        assert_eq!(
            loaded.get(SYSTEM_WORKSPACE_RESOURCE_SETTINGS_KEY),
            Some(&json!({
                "/tmp/project-a": {
                    "mode": "custom",
                    "skillNames": ["review"],
                    "mcpServerIds": ["github"],
                    "projectPrompt": "Review this project.",
                    "projectPromptStrategy": "replace",
                    "stateVersion": 3,
                    "writerId": "client-a",
                    "updatedAt": 100
                },
                "/tmp/project-b": {
                    "mode": "inherit",
                    "skillNames": [],
                    "mcpServerIds": [],
                    "projectPrompt": "",
                    "projectPromptStrategy": "append",
                    "stateVersion": 4,
                    "writerId": "client-b",
                    "updatedAt": now
                }
            }))
        );
    }

    #[test]
    fn workspace_resource_settings_are_not_truncated_after_one_hundred_paths() {
        let entries = (0..150)
            .map(|index| {
                (
                    format!("/tmp/project-{index}"),
                    json!({
                        "mode": "custom",
                        "skillNames": [format!("skill-{index}")],
                        "mcpServerIds": [],
                        "stateVersion": 1,
                        "writerId": "test",
                        "updatedAt": index + 1
                    }),
                )
            })
            .collect::<Map<String, Value>>();
        let normalized = normalize_workspace_resource_settings(Some(&Value::Object(entries)));
        let normalized = normalized.as_object().expect("normalized workspace resources");
        assert_eq!(normalized.len(), 150);
        assert_eq!(
            normalized["/tmp/project-149"]["skillNames"],
            json!(["skill-149"])
        );
    }

    #[test]
    fn workspace_resource_settings_expire_only_old_inherit_tombstones() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_millis() as u64;
        let old = now - WORKSPACE_RESOURCE_TOMBSTONE_TTL_MS - 1;
        let normalized = normalize_workspace_resource_settings(Some(&json!({
            "/tmp/old-tombstone": {
                "mode": "inherit",
                "stateVersion": 1,
                "updatedAt": old
            },
            "/tmp/custom": {
                "mode": "custom",
                "skillNames": ["kept"],
                "stateVersion": 1,
                "updatedAt": old
            },
            "/tmp/off": {
                "mode": "off",
                "stateVersion": 1,
                "updatedAt": old
            },
            "/tmp/recent-tombstone": {
                "mode": "inherit",
                "stateVersion": 1,
                "updatedAt": now
            },
            "/tmp/project-prompt": {
                "mode": "inherit",
                "projectPrompt": " Keep project context ",
                "projectPromptStrategy": "replace",
                "stateVersion": 1,
                "updatedAt": old
            }
        })));
        let normalized = normalized.as_object().expect("normalized workspace resources");
        assert!(!normalized.contains_key("/tmp/old-tombstone"));
        assert_eq!(normalized["/tmp/custom"]["mode"], "custom");
        assert_eq!(normalized["/tmp/off"]["mode"], "off");
        assert_eq!(normalized["/tmp/recent-tombstone"]["mode"], "inherit");
        assert_eq!(
            normalized["/tmp/project-prompt"]["projectPrompt"],
            "Keep project context"
        );
        assert_eq!(
            normalized["/tmp/project-prompt"]["projectPromptStrategy"],
            "replace"
        );
    }

    #[test]
    fn workspace_resource_overflow_prefers_active_entries_and_newest_tombstones() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_millis() as u64;
        let mut entries = Map::new();
        for index in 0..250_u64 {
            entries.insert(
                format!("/tmp/tombstone-{index:03}"),
                json!({
                    "mode": "inherit",
                    "stateVersion": 1,
                    "updatedAt": now - index
                }),
            );
        }
        for index in 0..20_u64 {
            entries.insert(
                format!("/tmp/custom-{index:02}"),
                json!({
                    "mode": if index % 2 == 0 { "custom" } else { "off" },
                    "skillNames": [format!("skill-{index}")],
                    "stateVersion": 1,
                    "updatedAt": now - 1_000_000 - index
                }),
            );
        }
        entries.insert(
            "/tmp/project-prompt".to_string(),
            json!({
                "mode": "inherit",
                "projectPrompt": "Keep project context",
                "projectPromptStrategy": "append",
                "stateVersion": 1,
                "updatedAt": 1
            }),
        );
        let normalized = normalize_workspace_resource_settings(Some(&Value::Object(entries)));
        let normalized = normalized.as_object().expect("normalized workspace resources");
        assert_eq!(normalized.len(), MAX_WORKSPACE_RESOURCE_SETTINGS);
        for index in 0..20 {
            assert!(normalized.contains_key(&format!("/tmp/custom-{index:02}")));
        }
        assert!(normalized.contains_key("/tmp/project-prompt"));
        assert!(normalized.contains_key("/tmp/tombstone-234"));
        assert!(!normalized.contains_key("/tmp/tombstone-235"));
    }

    #[test]
    fn workspace_resource_overflow_uses_unicode_code_point_ordering() {
        let mut entries = Map::new();
        for index in 0..253 {
            entries.insert(
                format!("/tmp/{index:03}"),
                json!({ "mode": "off", "stateVersion": 1, "updatedAt": 1 }),
            );
        }
        for suffix in ["A", "_", "a", "ä"] {
            entries.insert(
                format!("/tmp/{suffix}"),
                json!({ "mode": "off", "stateVersion": 1, "updatedAt": 1 }),
            );
        }
        let normalized = normalize_workspace_resource_settings(Some(&Value::Object(entries)));
        let normalized = normalized.as_object().expect("normalized workspace resources");
        assert_eq!(normalized.len(), MAX_WORKSPACE_RESOURCE_SETTINGS);
        assert!(normalized.contains_key("/tmp/A"));
        assert!(normalized.contains_key("/tmp/_"));
        assert!(normalized.contains_key("/tmp/a"));
        assert!(!normalized.contains_key("/tmp/ä"));
    }

    #[test]
    fn openagent_save_system_keeps_workspace_empty() {
        let mut conn = open_memory_db();
        save_system_with_default_workdir(&mut conn, json!({"executionMode":"tools", "workdir":""}), "/tmp/openagent/default-project").unwrap();
        let loaded = load_system(&conn).unwrap().unwrap();
        assert_eq!(loaded["workspaceProjects"], json!([]));
        assert_eq!(loaded["activeWorkspaceProjectId"], json!(""));
        assert_eq!(loaded["workdir"], json!(""));
    }

    #[test]
    fn openagent_removes_legacy_workspace_preserving_user_projects_and_history() {
        let mut conn = open_memory_db();
        let manual = json!({"id":"mine", "name":"My project", "path":"/tmp/mine", "kind":"manual", "createdAt":10, "updatedAt":20, "isPinned":true, "pinnedAt":30});
        let payload = json!({"executionMode":"tools", "workdir":"/tmp/openagent/default-project", "activeWorkspaceProjectId":"default-project",
            "workspaceProjects":[{"id":"default-project", "path":"/tmp/openagent/default-project", "kind":"managed"}, manual.clone()]});
        save_system_with_default_workdir(&mut conn, payload, "/tmp/openagent/default-project").unwrap();
        let loaded = load_system(&conn).unwrap().unwrap();
        assert_eq!(loaded["workspaceProjects"], json!([manual]));
        assert_eq!(loaded["activeWorkspaceProjectId"], json!("mine"));
        assert_eq!(loaded["workdir"], json!("/tmp/mine"));
        assert_eq!(loaded["hiddenWorkspaceProjectPaths"], json!(["/tmp/openagent/default-project"]));
        save_system_with_default_workdir(&mut conn, loaded.clone(), "/tmp/openagent/default-project").unwrap();
        assert_eq!(load_system(&conn).unwrap().unwrap(), loaded);
    }

    // P2#6:未识别的命令安全模式必须向严格侧(ask)收敛,不能静默降级成 auto ——
    // save_system 会把归一结果破坏性地写回磁盘。
    #[test]
    fn command_safety_mode_unrecognized_value_fails_closed_to_ask() {
        // 缺失 / null / 空串:正常缺省形态,默认 always。
        assert_eq!(normalize_command_safety_mode_value(None), json!("always"));
        assert_eq!(
            normalize_command_safety_mode_value(Some(&Value::Null)),
            json!("always")
        );
        assert_eq!(
            normalize_command_safety_mode_value(Some(&json!("   "))),
            json!("always")
        );
        // 已下线的"完全访问"(auto)迁移为"始终允许"。
        assert_eq!(
            normalize_command_safety_mode_value(Some(&json!(" auto "))),
            json!("always")
        );
        // 合法值原样保留(含空白裁剪)。
        for mode in [
            "ask", "autoEdit", "always", "autoReview", "sandbox", "sandboxOffline",
        ] {
            assert_eq!(
                normalize_command_safety_mode_value(Some(&json!(format!(" {mode} ")))),
                json!(mode)
            );
        }
        // 未来新增的模式值 / 回退旧版本 / 手改笔误 / 类型错误:一律收敛到 ask。
        assert_eq!(
            normalize_command_safety_mode_value(Some(&json!("sandboxStrictest"))),
            json!("ask")
        );
        assert_eq!(
            normalize_command_safety_mode_value(Some(&json!("Auto"))),
            json!("ask")
        );
        assert_eq!(
            normalize_command_safety_mode_value(Some(&json!(1))),
            json!("ask")
        );
    }

    #[test]
    fn openagent_fresh_install_has_no_default_workspace() {
        let conn = open_memory_db();
        let loaded = load_system_with_defaults(&conn, "/tmp/openagent/default-project").unwrap();
        assert_eq!(loaded["workspaceProjects"], json!([]));
        assert_eq!(loaded["activeWorkspaceProjectId"], json!(""));
        assert_eq!(loaded["workdir"], json!(""));
        assert_eq!(loaded["executionMode"], json!("tools"));
        assert_eq!(loaded["commandSafetyMode"], json!("ask"));
        assert_eq!(loaded[SYSTEM_RESOLVED_TIME_ZONE_KEY], json!(os_time_zone()));
    }

    #[test]
    fn normalize_default_time_zone_value_accepts_only_known_iana_zones() {
        assert_eq!(normalize_default_time_zone_value(None), json!(""));
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!(null))),
            json!("")
        );
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!(8))),
            json!("")
        );
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!("   "))),
            json!("")
        );
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!("Mars/Olympus"))),
            json!("")
        );
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!(" Asia/Shanghai "))),
            json!("Asia/Shanghai")
        );
        assert_eq!(
            normalize_default_time_zone_value(Some(&json!("UTC"))),
            json!("UTC")
        );
    }

    #[test]
    fn resolve_default_time_zone_prefers_setting_then_os() {
        assert_eq!(
            resolve_default_time_zone(Some("America/New_York")),
            "America/New_York"
        );
        assert_eq!(resolve_default_time_zone(Some("")), os_time_zone());
        assert_eq!(
            resolve_default_time_zone(Some("bogus/zone")),
            os_time_zone()
        );
        assert_eq!(resolve_default_time_zone(None), os_time_zone());
        assert!(os_time_zone().parse::<chrono_tz::Tz>().is_ok());
    }

    #[test]
    fn save_system_persists_default_time_zone_without_resolved_value() {
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "defaultTimeZone": "Europe/Berlin",
                "resolvedTimeZone": "Asia/Tokyo",
            }),
            "/tmp/liveagent-default-project",
        )
        .expect("save system");

        let stored = load_system(&conn)
            .expect("load system")
            .expect("system rows");
        assert_eq!(stored["defaultTimeZone"], json!("Europe/Berlin"));
        assert!(stored.get(SYSTEM_RESOLVED_TIME_ZONE_KEY).is_none());
        let resolved_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM system_settings WHERE setting_key = ?1",
                params![SYSTEM_RESOLVED_TIME_ZONE_KEY],
                |row| row.get(0),
            )
            .expect("count resolved rows");
        assert_eq!(resolved_rows, 0);

        let loaded = load_system_with_defaults(&conn, "/tmp/liveagent-default-project")
            .expect("load system with defaults");
        assert_eq!(loaded["defaultTimeZone"], json!("Europe/Berlin"));
        assert_eq!(loaded["resolvedTimeZone"], json!(os_time_zone()));

        save_system_with_default_workdir(
            &mut conn,
            json!({ "executionMode": "tools", "defaultTimeZone": "Nowhere/Invalid" }),
            "/tmp/liveagent-default-project",
        )
        .expect("save system with invalid zone");
        let loaded = load_system_with_defaults(&conn, "/tmp/liveagent-default-project")
            .expect("reload system");
        assert_eq!(loaded["defaultTimeZone"], json!(""));
        let resolved = loaded["resolvedTimeZone"].as_str().expect("resolved zone");
        assert!(!resolved.is_empty());
        assert_eq!(resolved, os_time_zone());
    }

    #[test]
    fn expand_home_prefix_supports_bare_tilde() {
        let home = dirs::home_dir().expect("home dir available in tests");
        assert_eq!(expand_home_prefix("~"), home);
    }

    #[test]
    fn expand_home_prefix_supports_forward_slash() {
        let home = dirs::home_dir().expect("home dir available in tests");
        assert_eq!(
            expand_home_prefix("~/OneDrive/ccswitch"),
            home.join("OneDrive/ccswitch")
        );
    }

    #[test]
    fn expand_home_prefix_supports_windows_backslash() {
        let home = dirs::home_dir().expect("home dir available in tests");
        assert_eq!(
            expand_home_prefix("~\\OneDrive\\ccswitch"),
            home.join("OneDrive\\ccswitch")
        );
    }

    #[test]
    fn expand_home_prefix_passes_through_absolute_paths() {
        assert_eq!(
            expand_home_prefix("/data/ccswitch"),
            PathBuf::from("/data/ccswitch")
        );
        assert_eq!(
            expand_home_prefix("C:\\Users\\Alice\\ccswitch"),
            PathBuf::from("C:\\Users\\Alice\\ccswitch")
        );
    }

    #[cfg(windows)]
    #[test]
    fn ccswitch_db_candidates_include_home_env_fallback_on_windows() {
        // 候选列表必须覆盖 ccswitch v3.10.3 在 `%HOME%\.cc-switch\` 的遗留库位置。
        let previous = std::env::var("HOME").ok();
        std::env::set_var("HOME", "C:\\legacy-home");
        let candidates = ccswitch_db_candidates();
        match previous {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        let expected = PathBuf::from("C:\\legacy-home")
            .join(".cc-switch")
            .join("cc-switch.db");
        assert!(candidates.contains(&expected));
    }

    #[test]
    fn cherry_split_v1_api_keys_handles_escaped_commas() {
        assert_eq!(
            cherry_split_v1_api_keys(r"first\,part, second, ,third"),
            vec!["first,part", "second", "third"]
        );
    }

    #[test]
    fn cherry_manual_data_candidates_support_portable_and_nested_directories() {
        let root = tempfile::tempdir().expect("tempdir");
        let portable = root.path().join("CherryStudioPortable");
        let data = portable.join("data");
        let local_storage = data.join("Local Storage");
        let leveldb = local_storage.join("leveldb");

        let portable_candidates = cherry_manual_data_candidates(&portable);
        assert!(portable_candidates.contains(&portable));
        assert!(portable_candidates.contains(&data));

        let local_storage_candidates = cherry_manual_data_candidates(&local_storage);
        assert!(local_storage_candidates.contains(&data));

        let leveldb_candidates = cherry_manual_data_candidates(&leveldb);
        assert!(leveldb_candidates.contains(&data));
    }

    #[test]
    fn cherry_normalize_routed_base_url_removes_endpoint_marker() {
        assert_eq!(
            cherry_normalize_routed_base_url("https://example.test/v1/chat/completions#"),
            "https://example.test/v1"
        );
        assert_eq!(
            cherry_normalize_routed_base_url(
                "https://generativelanguage.googleapis.com/v1beta/models/demo:generateContent#"
            ),
            "https://generativelanguage.googleapis.com/v1beta/models/demo"
        );
    }

    #[test]
    fn cherry_v1_new_api_splits_chat_protocols_and_filters_non_chat_models() {
        let provider = json!({
            "id": "mixed-provider",
            "name": "Mixed API",
            "type": "new-api",
            "apiKey": "secret",
            "apiHost": "https://example.test/v1",
            "enabled": true,
            "models": [
                { "id": "gpt-chat", "endpoint_type": "openai-chat-completions", "type": ["text"] },
                { "id": "claude-chat", "endpoint_type": "anthropic-messages", "type": ["text"] },
                { "id": "text-embedding-3-small", "endpoint_type": "openai-chat-completions", "type": ["embedding"] }
            ]
        });
        let mut imported = Vec::new();

        cherry_append_v1_provider(&provider, "1.9.9", &mut imported);

        assert_eq!(imported.len(), 2);
        assert!(imported.iter().all(|item| item.importable));
        assert!(imported.iter().all(|item| item.api_key == "secret"));
        assert!(imported.iter().all(|item| item.excluded_model_count == 1));
        assert!(!cherry_model_is_chat_compatible(
            &json!({"type": ["image_generation"]}),
            "nano-banana"
        ));
        assert!(imported.iter().any(|item| {
            item.provider_type == "codex" && item.request_format == "openai-completions"
        }));
        assert!(imported
            .iter()
            .any(|item| item.provider_type == "claude_code"));
    }

    #[test]
    fn cherry_v1_routes_official_deepseek_chat_to_deepseek_provider() {
        let provider = json!({
            "id": "official-deepseek",
            "name": "DeepSeek Official",
            "type": "openai",
            "apiKey": "secret",
            "apiHost": "https://api.deepseek.com/v1/chat/completions#",
            "models": [
                { "id": "deepseek-chat", "endpoint_type": "openai-chat-completions", "type": ["text"] }
            ]
        });
        let mut imported = Vec::new();

        cherry_append_v1_provider(&provider, "1.9.9", &mut imported);

        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].provider_type, "deepseek");
        assert_eq!(imported[0].request_format, "openai-completions");
        assert_eq!(imported[0].base_url, "https://api.deepseek.com/v1");
    }

    #[test]
    fn cherry_v1_keeps_third_party_deepseek_model_in_codex_provider() {
        let provider = json!({
            "id": "aggregate-gateway",
            "name": "Aggregate Gateway",
            "type": "openai",
            "apiKey": "secret",
            "apiHost": "https://relay.example.test/v1",
            "models": [
                { "id": "deepseek-chat", "endpoint_type": "openai-chat-completions", "type": ["text"] }
            ]
        });
        let mut imported = Vec::new();

        cherry_append_v1_provider(&provider, "1.9.9", &mut imported);

        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].provider_type, "codex");
        assert_eq!(imported[0].request_format, "openai-completions");
    }

    #[test]
    fn imported_provider_headers_preserve_order_and_filter_unsafe_duplicates() {
        let first = json!({
            "extraHeaders": [
                ["X-Trace", "one"],
                ["X-Empty", ""],
                ["X-Bad", "line\nfeed"]
            ]
        });
        let second = json!({
            "custom_headers": [
                ["x-trace", "replacement"],
                {"key": "X-Second", "value": "two"}
            ]
        });

        let headers = imported_headers_from_values(&[&first, &second]);
        assert_eq!(
            headers,
            vec![
                ImportedProviderHeader { key: "X-Trace".into(), value: "one".into() },
                ImportedProviderHeader { key: "X-Empty".into(), value: "".into() },
                ImportedProviderHeader { key: "X-Second".into(), value: "two".into() },
            ]
        );
    }

    #[test]
    fn ccs_imports_custom_headers_from_config_and_meta() {
        let config = json!({
            "env": {
                "DEEPSEEK_BASE_URL": "https://api.deepseek.com/v1",
                "DEEPSEEK_API_KEY": "sk-deepseek"
            },
            "extra_headers": {"X-Config": "config-value"}
        });
        let meta = json!({
            "customHeaders": [{"key": "X-Meta", "value": "meta-value"}]
        });
        let item = ccs_provider_from_value(
            "deepseek-with-headers",
            "deepseek",
            "DeepSeek",
            &config,
            &meta,
        )
        .expect("provider should import");

        assert_eq!(
            item.custom_headers,
            vec![
                ImportedProviderHeader { key: "X-Config".into(), value: "config-value".into() },
                ImportedProviderHeader { key: "X-Meta".into(), value: "meta-value".into() },
            ]
        );
    }

    #[test]
    fn cherry_v1_imports_custom_headers() {
        let provider = json!({
            "id": "headers-provider",
            "name": "Headers Provider",
            "type": "openai",
            "apiKey": "secret",
            "apiHost": "https://example.test/v1",
            "extra_headers": {"X-Provider": "provider-value"},
            "models": [{"id": "chat-model", "endpoint_type": "openai-chat-completions", "type": ["text"]}]
        });
        let mut imported = Vec::new();

        cherry_append_v1_provider(&provider, "1.9.9", &mut imported);

        assert_eq!(imported.len(), 1);
        assert_eq!(
            imported[0].custom_headers,
            vec![ImportedProviderHeader { key: "X-Provider".into(), value: "provider-value".into() }]
        );
    }

    #[test]
    fn ccs_maps_grokbuild_app_type_to_xai() {
        assert_eq!(
            ccs_provider_type_from_app_type("grokbuild"),
            Some("xai")
        );
        assert_eq!(ccs_provider_type_from_app_type("grok"), Some("xai"));
        assert_eq!(ccs_provider_type_from_app_type("xai"), Some("xai"));
        assert_eq!(ccs_provider_type_from_app_type("Grok-Build"), Some("xai"));
    }

    #[test]
    fn ccs_imports_deepseek_app_type_and_environment_fields() {
        let config = json!({
            "env": {
                "DEEPSEEK_BASE_URL": "https://api.deepseek.com/v1/",
                "DEEPSEEK_API_KEY": "sk-deepseek",
                "DEEPSEEK_MODEL": "deepseek-chat",
                "DEEPSEEK_REASONER_MODEL": "deepseek-reasoner"
            }
        });
        let item = ccs_provider_from_value(
            "deepseek-official",
            "deepseek",
            "DeepSeek Official",
            &config,
            &json!({}),
        )
        .expect("deepseek provider should import");

        assert_eq!(item.provider_type, "deepseek");
        assert_eq!(item.base_url, "https://api.deepseek.com/v1");
        assert_eq!(item.api_key, "sk-deepseek");
        assert_eq!(item.request_format, "openai-completions");
        assert_eq!(item.models, vec!["deepseek-chat", "deepseek-reasoner"]);
    }

    #[test]
    fn ccs_reclassifies_only_official_deepseek_codex_chat_configs() {
        let official = json!({
            "auth": { "OPENAI_API_KEY": "sk-official" },
            "config": "model = \"deepseek-chat\"\nmodel_provider = \"deepseek\"\n\n[model_providers.deepseek]\nbase_url = \"https://api.deepseek.com/v1\"\nwire_api = \"chat\"\n"
        });
        let aggregate = json!({
            "auth": { "OPENAI_API_KEY": "sk-relay" },
            "config": "model = \"deepseek-chat\"\nmodel_provider = \"relay\"\n\n[model_providers.relay]\nbase_url = \"https://relay.example.test/v1\"\nwire_api = \"chat\"\n"
        });

        let official_item =
            ccs_provider_from_value("official", "codex", "Official", &official, &json!({}))
                .expect("official config should import");
        let aggregate_item =
            ccs_provider_from_value("aggregate", "codex", "Aggregate", &aggregate, &json!({}))
                .expect("aggregate config should import");

        assert_eq!(official_item.provider_type, "deepseek");
        assert_eq!(official_item.request_format, "openai-completions");
        assert_eq!(aggregate_item.provider_type, "codex");
        assert_eq!(aggregate_item.request_format, "openai-completions");
    }

    #[test]
    fn ccs_imports_grokbuild_toml_config_fields() {
        // 与 CC-Switch Grok Build 写入 providers.settings_config 的形状对齐：
        // config 是 TOML 文本，含 [models].default 与 [model."<id>"] 表。
        let config = json!({
            "config": "[models]\ndefault = \"grok-4.5\"\n\n[model]\n[model.\"grok-4.5\"]\nmodel = \"grok-4.5\"\nbase_url = \"https://api.x.ai/v1\"\nname = \"packy\"\napi_backend = \"responses\"\ncontext_window = 500000\napi_key = \"sk-test-key\"\n"
        });
        let item = ccs_provider_from_value(
            "d262e762-test",
            "grokbuild",
            "PackyCode",
            &config,
            &json!({}),
        )
        .expect("grokbuild provider should import");

        assert_eq!(item.provider_type, "xai");
        assert_eq!(item.app_type, "grokbuild");
        assert_eq!(item.base_url, "https://api.x.ai/v1");
        assert_eq!(item.api_key, "sk-test-key");
        assert_eq!(item.request_format, "openai-responses");
        assert!(item.models.iter().any(|m| m == "grok-4.5"));
    }

    #[test]
    fn ccs_imports_empty_official_grokbuild_seed() {
        let config = json!({ "config": "" });
        let item = ccs_provider_from_value(
            "grokbuild-official",
            "grokbuild",
            "Grok Official",
            &config,
            &json!({}),
        )
        .expect("official grok seed should still map");
        assert_eq!(item.provider_type, "xai");
        assert_eq!(item.base_url, "");
        assert_eq!(item.api_key, "");
        assert_eq!(item.request_format, "openai-responses");
    }

    #[test]
    fn ccs_maps_claude_desktop_app_type_to_claude_code() {
        assert_eq!(
            ccs_provider_type_from_app_type("claude-desktop"),
            Some("claude_code")
        );
        assert_eq!(
            ccs_provider_type_from_app_type("claude_desktop"),
            Some("claude_code")
        );
        assert_eq!(
            ccs_provider_type_from_app_type("claudeDesktop"),
            Some("claude_code")
        );
    }

    #[test]
    fn ccs_imports_claude_desktop_direct_mode_provider() {
        // 与 cc-switch Claude Desktop 直连模式写库形状对齐：
        // env 存 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN，模型在 meta 的路由表里。
        let config = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://relay.example.test/",
                "ANTHROPIC_AUTH_TOKEN": "sk-desktop"
            }
        });
        let meta = json!({
            "claudeDesktopMode": "direct",
            "apiFormat": "anthropic",
            "claudeDesktopModelRoutes": {
                "claude-sonnet-4-5": { "model": "claude-sonnet-4-5" },
                "claude-opus-4-5": { "model": "claude-opus-4-5" }
            }
        });
        let item = ccs_provider_from_value(
            "desktop-1",
            "claude-desktop",
            "Desktop Relay",
            &config,
            &meta,
        )
        .expect("claude desktop direct provider should import");

        assert_eq!(item.provider_type, "claude_code");
        assert_eq!(item.app_type, "claude-desktop");
        assert_eq!(item.base_url, "https://relay.example.test");
        assert_eq!(item.api_key, "sk-desktop");
        assert_eq!(
            item.models,
            vec!["claude-opus-4-5", "claude-sonnet-4-5"]
        );
    }

    #[test]
    fn ccs_imports_claude_desktop_proxy_mode_anthropic_upstream() {
        // 映射模式 + Anthropic 上游：模型取 route.model（真实上游模型）。
        let config = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://gateway.example.test",
                "ANTHROPIC_API_KEY": "sk-proxy"
            }
        });
        let meta = json!({
            "claudeDesktopMode": "proxy",
            "apiFormat": "anthropic",
            "claudeDesktopModelRoutes": {
                "claude-sonnet-4-5": { "model": "kimi-k2", "labelOverride": "Kimi" }
            }
        });
        let item = ccs_provider_from_value(
            "desktop-2",
            "claude-desktop",
            "Desktop Proxy",
            &config,
            &meta,
        )
        .expect("anthropic-format proxy provider should import");

        assert_eq!(item.provider_type, "claude_code");
        assert_eq!(item.api_key, "sk-proxy");
        assert_eq!(item.models, vec!["kimi-k2"]);
    }

    #[test]
    fn ccs_skips_claude_desktop_non_anthropic_upstreams() {
        // 映射模式声明 openai_chat / openai_responses / gemini_native 上游时，
        // 依赖 cc-switch 内置网关转协议，不能直接当 Anthropic 供应商导入。
        let config = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.openai.example.test/v1",
                "ANTHROPIC_AUTH_TOKEN": "sk-openai"
            }
        });
        for format in ["openai_chat", "openai_responses", "gemini_native"] {
            let meta = json!({
                "claudeDesktopMode": "proxy",
                "apiFormat": format,
                "claudeDesktopModelRoutes": {
                    "claude-sonnet-4-5": { "model": "gpt-5.2" }
                }
            });
            assert!(
                ccs_provider_from_value("desktop-3", "claude-desktop", "GPT", &config, &meta)
                    .is_none(),
                "{format} upstream should be skipped"
            );
        }
    }

    #[test]
    fn ccs_imports_claude_desktop_official_seed_without_meta_format() {
        // 官方种子 settings_config 为 {"env":{}}，meta 无 apiFormat：
        // 应按 Anthropic 处理并保留（前端以空 base_url/api_key 置灰）。
        let config = json!({ "env": {} });
        let item = ccs_provider_from_value(
            "claude-desktop-official",
            "claude-desktop",
            "Claude Desktop 官方",
            &config,
            &json!({}),
        )
        .expect("official claude desktop seed should map");
        assert_eq!(item.provider_type, "claude_code");
        assert_eq!(item.base_url, "");
        assert_eq!(item.api_key, "");
        assert!(item.models.is_empty());
    }

    #[test]
    fn ccs_db_query_returns_claude_desktop_rows_with_meta() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("cc-switch.db");
        {
            let conn = Connection::open(&db_path).expect("create ccswitch db");
            conn.execute_batch(
                "CREATE TABLE providers (
                   id TEXT NOT NULL,
                   app_type TEXT NOT NULL,
                   name TEXT NOT NULL,
                   settings_config TEXT NOT NULL,
                   category TEXT,
                   created_at INTEGER,
                   sort_index INTEGER,
                   meta TEXT NOT NULL DEFAULT '{}',
                   is_current BOOLEAN NOT NULL DEFAULT 0,
                   PRIMARY KEY (id, app_type)
                 );",
            )
            .expect("create providers table");
            let insert = |id: &str, app_type: &str, name: &str, config: &str, meta: &str| {
                conn.execute(
                    "INSERT INTO providers (id, app_type, name, settings_config, meta, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                    rusqlite::params![id, app_type, name, config, meta],
                )
                .expect("insert provider row");
            };
            insert(
                "cli-1",
                "claude",
                "CLI Relay",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://cli.example.test","ANTHROPIC_AUTH_TOKEN":"sk-cli"}}"#,
                "{}",
            );
            insert(
                "desktop-direct",
                "claude-desktop",
                "Desktop Relay",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://desktop.example.test","ANTHROPIC_AUTH_TOKEN":"sk-desktop"}}"#,
                r#"{"claudeDesktopMode":"direct","apiFormat":"anthropic","claudeDesktopModelRoutes":{"claude-sonnet-4-5":{"model":"claude-sonnet-4-5"}}}"#,
            );
            insert(
                "desktop-openai",
                "claude-desktop",
                "Desktop OpenAI Proxy",
                r#"{"env":{"ANTHROPIC_BASE_URL":"https://openai.example.test/v1","ANTHROPIC_AUTH_TOKEN":"sk-openai"}}"#,
                r#"{"claudeDesktopMode":"proxy","apiFormat":"openai_chat","claudeDesktopModelRoutes":{"claude-sonnet-4-5":{"model":"gpt-5.2"}}}"#,
            );
        }

        let providers =
            list_ccswitch_liveagent_providers_from_db(&db_path).expect("query providers");
        let ids: Vec<&str> = providers
            .iter()
            .map(|item| item.source_id.as_str())
            .collect();
        assert!(ids.contains(&"cli-1"), "claude CLI row should import");
        assert!(
            ids.contains(&"desktop-direct"),
            "claude desktop direct row should import"
        );
        assert!(
            !ids.contains(&"desktop-openai"),
            "non-anthropic desktop upstream should be skipped"
        );

        let desktop = providers
            .iter()
            .find(|item| item.source_id == "desktop-direct")
            .expect("desktop provider present");
        assert_eq!(desktop.provider_type, "claude_code");
        assert_eq!(desktop.base_url, "https://desktop.example.test");
        assert_eq!(desktop.api_key, "sk-desktop");
        assert_eq!(desktop.models, vec!["claude-sonnet-4-5"]);
    }

    #[test]
    fn ccs_db_query_tolerates_missing_meta_column() {
        // ccswitch v0 老库没有 meta 列；LiveAgent 只读打开、不做迁移，
        // 查询需退化为空 meta 而不是整体失败。
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("cc-switch.db");
        {
            let conn = Connection::open(&db_path).expect("create ccswitch db");
            conn.execute_batch(
                "CREATE TABLE providers (
                   id TEXT NOT NULL,
                   app_type TEXT NOT NULL,
                   name TEXT NOT NULL,
                   settings_config TEXT NOT NULL,
                   sort_index INTEGER,
                   created_at INTEGER,
                   PRIMARY KEY (id, app_type)
                 );",
            )
            .expect("create legacy providers table");
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, created_at)
                 VALUES ('cli-legacy', 'claude', 'Legacy CLI',
                         '{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://legacy.example.test\",\"ANTHROPIC_AUTH_TOKEN\":\"sk-legacy\"}}', 1)",
                [],
            )
            .expect("insert legacy provider row");
        }

        let providers =
            list_ccswitch_liveagent_providers_from_db(&db_path).expect("query legacy providers");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].source_id, "cli-legacy");
        assert_eq!(providers[0].provider_type, "claude_code");
        assert_eq!(providers[0].base_url, "https://legacy.example.test");
    }

    #[test]
    fn provider_import_acceptance_databases_match_frontend_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/provider-import-acceptance.json"
        )))
        .expect("provider import fixture");
        let dir = tempfile::tempdir().expect("tempdir");
        let ccs_path = dir.path().join("cc-switch.db");
        let ccs = &fixture["ccs"];
        {
            let conn = Connection::open(&ccs_path).expect("create CC Switch database");
            conn.execute_batch(
                "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT,
                 settings_config TEXT, meta TEXT, sort_index INTEGER, created_at INTEGER);",
            )
            .expect("create providers table");
            conn.execute(
                "INSERT INTO providers VALUES (?1, ?2, ?3, ?4, ?5, 0, 1)",
                rusqlite::params![
                    ccs["id"].as_str(), ccs["appType"].as_str(), ccs["name"].as_str(),
                    ccs["settingsConfig"].to_string(), ccs["meta"].to_string()
                ],
            )
            .expect("insert CC Switch fixture");
        }
        let ccs_before = std::fs::read(&ccs_path).expect("read CC Switch database");
        let imported = list_ccswitch_liveagent_providers_from_db(&ccs_path).expect("scan CC Switch");
        assert_eq!(serde_json::to_value(imported).unwrap(), json!([ccs["expected"]]));
        assert_eq!(std::fs::read(&ccs_path).unwrap(), ccs_before);

        let cherry_path = dir.path().join("cherrystudio.sqlite");
        let cherry = &fixture["cherry"];
        {
            let conn = Connection::open(&cherry_path).expect("create Cherry Studio database");
            conn.execute_batch(
                "CREATE TABLE user_provider (provider_id TEXT, name TEXT, endpoint_configs TEXT,
                 default_chat_endpoint TEXT, api_keys TEXT, auth_config TEXT,
                 provider_settings TEXT, is_enabled BOOLEAN, order_key INTEGER);
                 CREATE TABLE user_model (provider_id TEXT, model_id TEXT, endpoint_types TEXT,
                 capabilities TEXT, output_modalities TEXT, is_enabled BOOLEAN,
                 is_hidden BOOLEAN, order_key INTEGER);",
            )
            .expect("create Cherry Studio tables");
            conn.execute(
                "INSERT INTO user_provider VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 0)",
                rusqlite::params![
                    cherry["id"].as_str(), cherry["name"].as_str(),
                    cherry["endpointConfigs"].to_string(), cherry["defaultChatEndpoint"].as_str(),
                    cherry["apiKeys"].to_string(), cherry["authConfig"].to_string(),
                    cherry["providerSettings"].to_string()
                ],
            )
            .expect("insert Cherry Studio fixture");
            for model in cherry["models"].as_array().unwrap() {
                conn.execute(
                    "INSERT INTO user_model VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                    rusqlite::params![
                        cherry["id"].as_str(), model["id"].as_str(),
                        model["endpointTypes"].to_string(), model["capabilities"].to_string(),
                        model["outputModalities"].to_string(), model["enabled"].as_bool(),
                        model["hidden"].as_bool()
                    ],
                )
                .expect("insert Cherry Studio model");
            }
        }
        let cherry_before = std::fs::read(&cherry_path).expect("read Cherry Studio database");
        let imported = cherry_scan_candidates(&[dir.path().to_path_buf()], true)
            .expect("scan Cherry Studio data directory");
        assert_eq!(imported.status, "success");
        assert_eq!(serde_json::to_value(imported.providers).unwrap(), json!([cherry["expected"]]));
        assert_eq!(std::fs::read(&cherry_path).unwrap(), cherry_before);
    }

    // ===== 配置备份：采集 / 校验 / 应用 =====

    fn sample_backup_document() -> String {
        let snapshot = BackupSnapshot {
            providers: Some(json!([{ "id": "p-1", "name": "P1", "apiKey": "sk-plain" }])),
            mcp: Some(json!({ "servers": [{ "id": "s-1" }], "selected": ["s-1"] })),
            system: Some(json!({ "executionMode": "tools" })),
            agents: Some(json!([
                { "id": "t-1", "name": "T1", "prompt": "prompt", "enabled": true }
            ])),
            model_failover: Some(json!({ "claude_code": { "queue": ["p-1"] } })),
            stt: Some(json!({
                "provider": "aliyun_dashscope",
                "providers": { "aliyun_dashscope": { "id": "aliyun_dashscope", "apiKey": "sk" } }
            })),
        };
        let manifest = build_backup_manifest(&snapshot);
        serialize_backup_document(&snapshot, &manifest).expect("serialize document")
    }

    #[test]
    fn backup_document_round_trips_all_domains() {
        let raw = sample_backup_document();
        let (snapshot, manifest) = parse_backup_document(&raw).expect("parse document");

        assert_eq!(manifest.protocol_version, BACKUP_PROTOCOL_VERSION);
        assert_eq!(manifest.schema_version, BACKUP_SCHEMA_VERSION);
        assert_eq!(manifest.encryption, "none");
        // 旧备份仍可解析；已移除的语音配置不计入导入摘要。
        assert_eq!(manifest.domains.providers, 1);
        assert_eq!(manifest.domains.mcp, 1);
        assert_eq!(manifest.domains.agents, 1);
        assert_eq!(manifest.domains.model_failover, 1);
        assert_eq!(manifest.domains.stt, 0);
        assert_eq!(
            snapshot.model_failover,
            Some(json!({ "claude_code": { "queue": ["p-1"] } }))
        );
        assert!(snapshot.agents.is_some());
        assert!(snapshot.stt.is_some());
    }

    #[test]
    fn parse_backup_document_ignores_v1_skills_and_survives_device_local_system() {
        // v1 备份带 skills 域与 system 里的设备本地键；v2 解析时 skills 被
        // serde 忽略，设备本地键在应用侧被白名单过滤（见 merge 测试）。
        let mut document: Value =
            serde_json::from_str(&sample_backup_document()).expect("parse json");
        document["_manifest"]["schemaVersion"] = json!(1);
        document["skills"] = json!({ "enabled": true, "selected": ["skill-a"] });
        document["system"]["workdir"] = json!("/home/alice/code");

        let (snapshot, manifest) =
            parse_backup_document(&document.to_string()).expect("v1 document must parse");
        assert_eq!(manifest.schema_version, 1);
        // skills 不再是快照字段，序列化后不应再出现。
        let reserialized = serde_json::to_string(&snapshot).expect("serialize snapshot");
        assert!(!reserialized.contains("skill-a"), "skills 域应被忽略");
    }

    #[test]
    fn parse_backup_document_rejects_future_versions() {
        // 高版本必须拒绝，而不是把读不懂的域当成「空配置」写入而静默清库。
        for field in ["protocolVersion", "schemaVersion"] {
            let mut document: Value =
                serde_json::from_str(&sample_backup_document()).expect("parse json");
            document["_manifest"][field] = json!(99);
            let err = parse_backup_document(&document.to_string())
                .expect_err("future version must be rejected");
            assert!(err.contains("99"), "错误信息应含版本号：{err}");
        }
    }

    #[test]
    fn parse_backup_document_rejects_unknown_encryption() {
        let mut document: Value =
            serde_json::from_str(&sample_backup_document()).expect("parse json");
        document["_manifest"]["encryption"] = json!("aes-256-gcm");

        let err = parse_backup_document(&document.to_string())
            .expect_err("unknown encryption must be rejected");
        assert!(err.contains("aes-256-gcm"), "错误信息应含加密方式：{err}");
    }

    #[test]
    fn parse_backup_document_rejects_missing_manifest_and_malformed_domains() {
        // 缺 manifest：可能是随便一个 JSON 文件，不是我们导出的备份。
        let err = parse_backup_document(r#"{"providers": []}"#).expect_err("manifest required");
        assert!(err.contains("元信息"), "应提示缺少元信息：{err}");

        // 域结构不符：providers 必须是数组。
        let mut document: Value =
            serde_json::from_str(&sample_backup_document()).expect("parse json");
        document["providers"] = json!({ "not": "an array" });
        let err =
            parse_backup_document(&document.to_string()).expect_err("providers must be an array");
        assert!(err.contains("providers"), "应指出出错的域：{err}");
    }


    #[test]
    fn collect_backup_snapshot_keeps_only_portable_system_keys() {
        // system 域里 workdir / 工作区路径 / 系统代理是设备本地态：
        // 绝对路径在另一台机器上不存在，代理密码明文外流也毫无意义。
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "commandSafetyMode": "ask",
                "toolPolicies": { "Bash": "ask" },
                "workdir": "/home/alice/secret-project",
                "systemProxy": {
                    "enabled": true,
                    "type": "http",
                    "host": "127.0.0.1",
                    "port": 7890,
                    "username": "proxy-user",
                    "password": "proxy-sentinel-password"
                }
            }),
            "/home/alice/secret-project",
        )
        .expect("seed system");

        let snapshot = collect_backup_snapshot(&conn).expect("collect snapshot");
        let serialized = serde_json::to_string(&snapshot).expect("serialize snapshot");
        let system = snapshot.system.expect("system domain present");
        let system = system.as_object().expect("system is object");

        assert_eq!(system.get("executionMode"), Some(&json!("tools")));
        assert_eq!(system.get("commandSafetyMode"), Some(&json!("ask")));
        assert_eq!(system.get("toolPolicies"), Some(&json!({ "Bash": "ask" })));
        for device_local in [
            "workdir",
            "systemProxy",
            "workspaceProjects",
            "workspaceProjectGroups",
            "activeWorkspaceProjectId",
            "hiddenWorkspaceProjectPaths",
            "missingWorkspaceProjectPaths",
            "archivedWorkspaceProjectPaths",
            "workspaceResourceSettings",
        ] {
            assert!(
                !system.contains_key(device_local),
                "设备本地键 {device_local} 不应进快照"
            );
        }
        assert!(
            !serialized.contains("proxy-sentinel-password"),
            "代理密码不得进快照"
        );
        assert!(
            !serialized.contains("secret-project"),
            "本机路径不得进快照"
        );
    }

    #[test]
    fn merge_portable_system_overlays_whitelist_and_preserves_device_local_values() {
        // 应用快照时 system 走「可移植键叠加」：快照里的 executionMode 等
        // 覆盖本机，workdir / 代理保持本机原值；v1 快照混入的设备本地键被丢弃。
        let mut conn = open_memory_db();
        save_system_with_default_workdir(
            &mut conn,
            json!({
                "executionMode": "tools",
                "commandSafetyMode": "auto",
                "workdir": "/local/workdir",
                "systemProxy": {
                    "enabled": true,
                    "type": "http",
                    "host": "127.0.0.1",
                    "port": 7890,
                    "username": "",
                    "password": "local-proxy-password"
                }
            }),
            "/local/workdir",
        )
        .expect("seed local system");

        let snapshot_system = json!({
            "executionMode": "chat",
            "commandSafetyMode": "ask",
            // v1 快照可能带设备本地键，必须被忽略而不是覆盖本机。
            "workdir": "/remote/other-device",
            "systemProxy": { "enabled": false }
        });
        let merged = merge_portable_system(&conn, &snapshot_system).expect("merge");
        save_system_with_default_workdir(&mut conn, merged, "/local/workdir")
            .expect("apply merged system");

        let system = load_system(&conn)
            .expect("load system")
            .expect("system present");
        assert_eq!(system["executionMode"], json!("chat"), "可移植键应被覆盖");
        assert_eq!(system["commandSafetyMode"], json!("ask"));
        assert_eq!(system["workdir"], json!("/local/workdir"), "workdir 保持本机原值");
        assert_eq!(
            system["systemProxy"]["password"],
            json!("local-proxy-password"),
            "本机代理配置不受快照影响"
        );
        assert_eq!(system["systemProxy"]["enabled"], json!(true));
    }


    #[test]
    fn apply_backup_snapshot_to_db_overwrites_all_domains() {
        let mut conn = open_memory_db();
        save_providers(&mut conn, json!([{ "id": "stale", "name": "Stale" }]))
            .expect("seed providers");
        save_agents(
            &mut conn,
            json!([{ "id": "stale-t", "name": "Stale", "prompt": "old" }]),
        )
        .expect("seed agents");

        let snapshot = BackupSnapshot {
            providers: Some(json!([{ "id": "p-1", "name": "P1" }])),
            mcp: Some(json!({ "servers": [{ "id": "s-1" }], "selected": ["s-1"] })),
            system: None,
            agents: Some(json!([
                { "id": "t-1", "name": "T1", "prompt": "prompt", "enabled": true }
            ])),
            model_failover: Some(json!({ "claude_code": { "queue": ["p-1"] } })),
            stt: Some(json!({
                "provider": "aliyun_dashscope",
                "providers": {
                    "aliyun_dashscope": {
                        "id": "aliyun_dashscope",
                        "websocketUrl": "wss://example.com/stt",
                        "model": "m",
                        "apiKey": "sk-stt"
                    }
                }
            })),
        };
        apply_backup_snapshot_to_db(&mut conn, &snapshot).expect("apply snapshot");

        // 整域覆盖：导入侧原有的 stale provider / 模板必须消失。
        assert_eq!(
            load_providers(&conn).expect("load providers"),
            Some(json!([{ "id": "p-1", "name": "P1" }]))
        );
        let mcp = load_mcp(&conn).expect("load mcp").expect("mcp present");
        assert_eq!(mcp["selected"], json!(["s-1"]));
        let agents = load_agents(&conn)
            .expect("load agents")
            .expect("agents present");
        assert_eq!(agents[0]["id"], json!("t-1"), "旧模板应被整域覆盖");
        assert_eq!(
            load_model_failover(&conn).expect("load model failover"),
            Some(json!({ "claude_code": { "queue": ["p-1"] } }))
        );
        assert!(load_stt_raw(&conn).expect("load legacy speech settings").is_none(),
            "removed speech credentials must not be restored");
    }

    #[test]
    fn local_backup_excludes_legacy_speech_secrets() {
        let mut conn = open_memory_db();
        save_stt(&mut conn, json!({
            "provider": "aliyun_dashscope",
            "providers": { "aliyun_dashscope": { "id": "aliyun_dashscope", "apiKey": "legacy-test-secret", "websocketUrl": "wss://example.invalid/stt", "model": "fixture" } }
        })).expect("seed legacy speech settings");
        let snapshot = collect_backup_snapshot(&conn).expect("collect local backup");
        assert!(snapshot.stt.is_none());
        let document = serialize_backup_document(&snapshot, &build_backup_manifest(&snapshot)).expect("serialize local backup");
        assert!(!document.contains("legacy-test-secret"));
        let value: Value = serde_json::from_str(&document).unwrap();
        assert!(value.get("stt").is_none());
    }

    #[test]
    fn apply_backup_snapshot_accepts_intentionally_incomplete_stt() {
        // 旧备份中的语音配置可以被解析，但不再恢复到本机。
        let mut conn = open_memory_db();
        let snapshot = BackupSnapshot {
            stt: Some(json!({
                "provider": "tencent_cloud",
                "providers": {
                    "tencent_cloud": { "id": "tencent_cloud", "appId": "", "secretId": "" }
                }
            })),
            ..Default::default()
        };
        apply_backup_snapshot_to_db(&mut conn, &snapshot)
            .expect("incomplete stt from a valid source must apply");
        assert!(load_stt_raw(&conn).expect("load stt").is_none());
    }

    #[test]
    fn apply_backup_snapshot_to_db_leaves_config_intact_when_domain_absent() {
        // 某域为 None 表示导出侧没有该配置，不应被当成「清空」。
        let mut conn = open_memory_db();
        save_providers(&mut conn, json!([{ "id": "keep", "name": "Keep" }]))
            .expect("seed providers");

        apply_backup_snapshot_to_db(&mut conn, &BackupSnapshot::default()).expect("apply empty");

        assert_eq!(
            load_providers(&conn).expect("load providers"),
            Some(json!([{ "id": "keep", "name": "Keep" }]))
        );
    }

    #[test]
    fn apply_backup_snapshot_remaps_provider_ids_to_local_identity() {
        // 两台设备各自「添加」过同一个服务商时 UUID 必不同。导入若原样落
        // 源 id，本机会话 / 默认模型 / 记忆 / 定时任务里存的
        // {customProviderId} 全部失配，规范化时被静默清空。
        let mut conn = open_memory_db();
        save_providers(
            &mut conn,
            json!([
                {
                    "id": "local-uuid-claude",
                    "type": "claude_code",
                    "baseUrl": "",
                    "name": "Claude",
                    "apiKey": "sk-local-old"
                },
                { "id": "builtin-codex", "type": "codex", "baseUrl": "", "name": "Codex" }
            ]),
        )
        .expect("seed local providers");

        let snapshot = BackupSnapshot {
            providers: Some(json!([
                // 身份相同（type+baseUrl+name）、id 不同 → 改写为本机 id。
                {
                    "id": "source-uuid-claude",
                    "type": "claude_code",
                    "baseUrl": "",
                    "name": "Claude",
                    "apiKey": "sk-source-new"
                },
                // id 相同（内置槽位）→ 原样保留。
                { "id": "builtin-codex", "type": "codex", "baseUrl": "", "name": "Codex" },
                // 本机不存在的新 provider → 保留源 id。
                {
                    "id": "source-uuid-fresh",
                    "type": "openai_compatible",
                    "baseUrl": "https://fresh.example.com/v1",
                    "name": "Fresh"
                }
            ])),
            model_failover: Some(json!({
                "claude_code": { "queue": ["source-uuid-claude", "source-uuid-fresh"] }
            })),
            ..Default::default()
        };
        apply_backup_snapshot_to_db(&mut conn, &snapshot).expect("apply snapshot");

        let providers = load_providers(&conn)
            .expect("load providers")
            .expect("providers present");
        let ids: Vec<&str> = providers
            .as_array()
            .expect("providers array")
            .iter()
            .map(|provider| provider["id"].as_str().expect("provider id"))
            .collect();
        assert_eq!(
            ids,
            vec!["local-uuid-claude", "builtin-codex", "source-uuid-fresh"],
            "同身份 provider 应保留本机 id，其余保持不变"
        );
        // id 保留本机，内容以备份为准。
        assert_eq!(providers[0]["apiKey"], json!("sk-source-new"));
        // failover 队列随 providers 一起改写，域间引用保持一致。
        assert_eq!(
            load_model_failover(&conn).expect("load model failover"),
            Some(json!({
                "claude_code": { "queue": ["local-uuid-claude", "source-uuid-fresh"] }
            }))
        );
    }

    #[test]
    fn provider_id_map_matches_by_endpoint_and_refuses_ambiguity() {
        let as_array = |value: &Value| value.as_array().expect("array").clone();

        // 第 3 级：仅改过显示名，type+baseUrl（尾斜杠归一）两侧唯一即可配对。
        let incoming = json!([
            {
                "id": "source-a",
                "type": "openai_compatible",
                "baseUrl": "https://api.example.com/v1",
                "name": "改名后"
            }
        ]);
        let local = json!([
            {
                "id": "local-a",
                "type": "openai_compatible",
                "baseUrl": "https://api.example.com/v1/",
                "name": "旧名"
            }
        ]);
        let id_map = build_provider_id_map(&as_array(&incoming), &as_array(&local));
        assert_eq!(id_map.get("source-a"), Some(&"local-a".to_string()));

        // 同端点出现两个本机候选（多账号）时无法分辨，宁可不配也不错配。
        let ambiguous_local = json!([
            {
                "id": "local-1",
                "type": "openai_compatible",
                "baseUrl": "https://api.example.com/v1",
                "name": "账号一"
            },
            {
                "id": "local-2",
                "type": "openai_compatible",
                "baseUrl": "https://api.example.com/v1",
                "name": "账号二"
            }
        ]);
        let id_map = build_provider_id_map(&as_array(&incoming), &as_array(&ambiguous_local));
        assert!(id_map.is_empty(), "歧义候选不得配对：{id_map:?}");

        // 缺 type 的条目不参与身份配对，避免把碰巧同名的配置错认成同一个。
        let untyped_incoming = json!([{ "id": "source-x", "name": "同名" }]);
        let untyped_local = json!([{ "id": "local-x", "name": "同名" }]);
        let id_map =
            build_provider_id_map(&as_array(&untyped_incoming), &as_array(&untyped_local));
        assert!(id_map.is_empty(), "缺 type 不得配对：{id_map:?}");
    }

    #[test]
    fn provider_id_rewrite_updates_legacy_failover_queue_entries() {
        // 旧版 failover queue 存 { customProviderId, model } 对象，改写需兼容。
        let mut snapshot = BackupSnapshot {
            providers: Some(json!([
                { "id": "source-a", "type": "claude_code", "baseUrl": "", "name": "Claude" }
            ])),
            model_failover: Some(json!({
                "claude_code": {
                    "queue": [
                        { "customProviderId": "source-a", "model": "claude-4.6" },
                        "unrelated-id"
                    ]
                }
            })),
            ..Default::default()
        };
        let id_map = HashMap::from([("source-a".to_string(), "local-a".to_string())]);
        rewrite_snapshot_provider_ids(&mut snapshot, &id_map);

        assert_eq!(
            snapshot.providers,
            Some(json!([
                { "id": "local-a", "type": "claude_code", "baseUrl": "", "name": "Claude" }
            ]))
        );
        assert_eq!(
            snapshot.model_failover,
            Some(json!({
                "claude_code": {
                    "queue": [
                        { "customProviderId": "local-a", "model": "claude-4.6" },
                        "unrelated-id"
                    ]
                }
            }))
        );
    }

    #[test]
    fn validate_backup_snapshot_rejects_malformed_domains() {
        let cases = [
            (
                BackupSnapshot {
                    providers: Some(json!({})),
                    ..Default::default()
                },
                "providers",
            ),
            (
                BackupSnapshot {
                    mcp: Some(json!({ "servers": "nope" })),
                    ..Default::default()
                },
                "mcp.servers",
            ),
            (
                BackupSnapshot {
                    system: Some(json!([])),
                    ..Default::default()
                },
                "system",
            ),
            (
                BackupSnapshot {
                    agents: Some(json!({})),
                    ..Default::default()
                },
                "agents",
            ),
            (
                BackupSnapshot {
                    model_failover: Some(json!([])),
                    ..Default::default()
                },
                "modelFailover",
            ),
            (
                BackupSnapshot {
                    stt: Some(json!("nope")),
                    ..Default::default()
                },
                "stt",
            ),
        ];

        for (snapshot, expected) in cases {
            let err =
                validate_backup_snapshot(&snapshot).expect_err("malformed domain must be rejected");
            assert!(err.contains(expected), "错误信息应含 {expected}：{err}");
        }
    }

    // ===== WebDAV 同步：配置解析 / 远端路径 / 完整性校验 =====






    // 保存配置必须清掉遗留的自动同步错误。
    //
    // 那条错误描述的是改动**之前**的配置状态；继续挂在界面上，用户会以为
    // 刚填好的新地址也是坏的，从而反复折腾一个已经修好的问题。



}
