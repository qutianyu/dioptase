use std::process::Command;
use std::sync::Mutex;
use tauri::State;

pub struct CaffeinateState {
    pub child: Mutex<Option<std::process::Child>>,
    pub end_time: Mutex<Option<std::time::Instant>>,
}

#[tauri::command]
pub fn start_caffeinate(
    duration_minutes: u64,
    state: State<'_, CaffeinateState>,
) -> Result<String, String> {
    {
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            let _ = child.kill();
        }
        *child_guard = None;
    }
    *state.end_time.lock().unwrap() = None;

    let mut cmd = Command::new("caffeinate");
    cmd.arg("-i");

    let end_time = if duration_minutes > 0 {
        let secs = duration_minutes * 60;
        cmd.arg("-t");
        cmd.arg(secs.to_string());
        Some(std::time::Instant::now() + std::time::Duration::from_secs(secs))
    } else {
        None
    };

    let child = cmd.spawn().map_err(|e| format!("Failed to start caffeinate: {}", e))?;

    *state.child.lock().unwrap() = Some(child);
    *state.end_time.lock().unwrap() = end_time;

    Ok("Caffeinate started".to_string())
}

#[tauri::command]
pub fn stop_caffeinate(state: State<'_, CaffeinateState>) -> Result<String, String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    *state.end_time.lock().unwrap() = None;
    Ok("Caffeinate stopped".to_string())
}

#[tauri::command]
pub fn caffeinate_status(state: State<'_, CaffeinateState>) -> serde_json::Value {
    let child_guard = state.child.lock().unwrap();
    let end_time_guard = state.end_time.lock().unwrap();

    let active = child_guard.is_some();
    let remaining = if let Some(end) = *end_time_guard {
        let now = std::time::Instant::now();
        if now < end {
            Some((end - now).as_secs())
        } else {
            Some(0)
        }
    } else if active {
        None
    } else {
        None
    };

    serde_json::json!({
        "active": active,
        "remaining_seconds": remaining,
    })
}