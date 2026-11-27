#[tauri::command]
pub async fn settings_load_all() -> Result<SettingsLoadResponse, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = open_db()?;
        let default_workdir = default_project_workdir()?;
        Ok(SettingsLoadResponse {
            providers: load_providers(&conn)?,
            system: Some(load_system_with_defaults(&conn, &default_workdir)?),
            mcp: load_mcp(&conn)?,
            agents: load_agents(&conn)?,
            ssh: None,
            remote: None,
            stt: None,
            memory: load_memory(&conn)?,
            model_failover: load_model_failover(&conn)?,
            default_workdir: String::new(),
        })
    })
    .await
    .map_err(|e| format!("settings_load_all join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_providers(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_providers(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_providers join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_system(
    payload: Value,
    automation_scheduler: tauri::State<'_, Arc<AutomationScheduler>>,
    kbrain_backend: tauri::State<'_, Arc<crate::services::kbrain_backend::KBrainBackendState>>,
) -> Result<(), String> {
    let kbrain_backend = Arc::clone(kbrain_backend.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_system(&mut conn, payload)?;
        // 保存成功后刷新全局代理状态，让 shell env 注入与出网代理即时生效。
        let proxy_revision = crate::services::system_proxy::revision();
        refresh_system_proxy_state(&conn)?;
        // 代理真实变化时推给运行中的 K-brain（best effort，失败只记日志）。
        if crate::services::system_proxy::revision() != proxy_revision {
            kbrain_backend.push_proxy_setting();
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("settings_save_system join 失败：{e}"))??;
    // Bash cron tasks execute in the system workdir; reschedule so the new
    // workdir takes effect without an app restart.
    // 默认时区可能已变:先让缓存失效,记忆等高频调用方立即读到新时区。
    invalidate_default_tz_cache();
    automation_scheduler.request_reload();
    Ok(())
}

#[tauri::command]
pub async fn settings_save_mcp(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_mcp(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_mcp join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_memory(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_memory(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_memory join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_model_failover(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_model_failover(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_model_failover join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_reveal_stt_secret(
    provider: String,
    field: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        load_stt_secret(&conn, &provider, &field)
    })
    .await
    .map_err(|e| format!("settings_reveal_stt_secret join failed: {e}"))?
}

#[tauri::command]
pub async fn settings_save_agents(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_agents(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_agents join 失败：{e}"))?
}
