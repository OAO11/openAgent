use crate::services::provider_usage::{ProviderUsageResult, ProviderUsageService};
use crate::services::workspace_watch::WorkspaceWatchService;
use std::sync::Arc;

#[tauri::command]
pub async fn provider_usage_query(
    provider_id: String,
    refresh: bool,
    provider_usage_service: tauri::State<'_, Arc<ProviderUsageService>>,
) -> Result<ProviderUsageResult, String> {
    Ok(provider_usage_service.query(&provider_id, refresh).await)
}

#[tauri::command]
pub async fn provider_usage_test(
    provider_id: String,
    config_json: String,
    provider_usage_service: tauri::State<'_, Arc<ProviderUsageService>>,
) -> Result<ProviderUsageResult, String> {
    Ok(provider_usage_service
        .test(&provider_id, &config_json)
        .await)
}

#[tauri::command]
pub fn workspace_watch_set(
    workdirs: Vec<String>,
    watcher: tauri::State<'_, Arc<WorkspaceWatchService>>,
) -> Result<(), String> {
    watcher.set_desired(workdirs);
    Ok(())
}
