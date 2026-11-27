pub mod backend;
#[cfg(test)]
mod calendar_import;
#[cfg(test)]
mod hierarchy;
mod legacy;
pub mod notification;
#[cfg(test)]
pub mod store;
#[cfg(test)]
pub mod subscription;
#[cfg(test)]
mod task_import;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub mod time;
#[cfg(test)]
mod trash;
pub mod types;
use std::sync::RwLock;
#[cfg(test)]
pub use store::PlanningStore;
use tauri::Emitter;
pub use types::*;

/// Reminder notification title, pushed by the frontend in the UI language
/// (the backend has no locale of its own, same as the tray menu).
static NOTIFICATION_TITLE: RwLock<String> = RwLock::new(String::new());

pub fn set_notification_title(title: String) {
    if let Ok(mut current) = NOTIFICATION_TITLE.write() {
        *current = title.chars().take(120).collect();
    }
}

fn notification_title() -> String {
    NOTIFICATION_TITLE
        .read()
        .ok()
        .filter(|title| !title.trim().is_empty())
        .map(|title| title.clone())
        .unwrap_or_else(|| "LiveAgent".into())
}

pub fn changed(app: &tauri::AppHandle, seq: u64) {
    let _ = app.emit("planning:changed", seq);
}

pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(30));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            timer.tick().await;
            if notification::disabled() {
                continue;
            }
            let claimed = backend::request(&app, "reminders.claim", serde_json::json!({})).await;
            if let Ok(serde_json::Value::Array(reminders)) = claimed {
                for mut reminder in reminders {
                    let delivery = notification::deliver(
                        &app,
                        reminder["id"].as_str().unwrap_or("").to_string(),
                        notification_title(),
                        reminder["title"].as_str().unwrap_or("").to_string(),
                        false,
                    )
                    .await;
                    let success = delivery.is_ok();
                    if let Err(error) = delivery {
                        eprintln!("[planning] notification delivery failed: {error}");
                    }
                    reminder["success"] = serde_json::json!(success);
                    let _ = backend::request(&app, "reminders.finish", reminder).await;
                }
            }
        }
    });
}
