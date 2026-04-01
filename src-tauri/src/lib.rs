use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{Emitter, Manager, State};

#[cfg(feature = "resource-engine-sdk")]
unsafe extern "C" {
    fn qualia_sdk_initialize(config_json: *const std::ffi::c_char) -> i32;
    fn qualia_sdk_shutdown() -> i32;
    fn qualia_sdk_record_activity(bytes_used: u64) -> i32;
}

#[derive(Default)]
struct RuntimeState {
    active: bool,
    operator_email: Option<String>,
    operator_id: Option<String>,
    tier: Option<String>,
    session_started_at: Option<Instant>,
    accrued_seconds: u64,
    accuracy_index: f64,
    system_resource_utilization: f64,
    work_stream_gb: f64,
    today_approved: u32,
    today_rejected: u32,
    status_line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    active: bool,
    operator_id: Option<String>,
    tier: Option<String>,
    active_session_seconds: u64,
    accuracy_index: f64,
    system_resource_utilization: f64,
    work_stream_gb: f64,
    today_approved: u32,
    today_rejected: u32,
    status_line: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftStartResult {
    operator_id: String,
    snapshot: RuntimeSnapshot,
}

fn build_operator_id(email: &str) -> String {
    let head = email
        .split('@')
        .next()
        .unwrap_or("operator")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_uppercase();
    format!("OP-{}", head)
}

fn snapshot_from(state: &RuntimeState) -> RuntimeSnapshot {
    let live_seconds = state
        .session_started_at
        .map(|started| started.elapsed().as_secs())
        .unwrap_or(0);

    RuntimeSnapshot {
        active: state.active,
        operator_id: state.operator_id.clone(),
        tier: state.tier.clone(),
        active_session_seconds: state.accrued_seconds + live_seconds,
        accuracy_index: state.accuracy_index,
        system_resource_utilization: state.system_resource_utilization,
        work_stream_gb: state.work_stream_gb,
        today_approved: state.today_approved,
        today_rejected: state.today_rejected,
        status_line: state.status_line.clone(),
    }
}

#[cfg(feature = "resource-engine-sdk")]
fn initialize_resource_engine(operator_email: &str, tier: &str) -> Result<(), String> {
    let config = serde_json::json!({
        "operatorEmail": operator_email,
        "tier": tier,
        "surface": "desktop",
        "consentMode": "explicit",
    });
    let config = std::ffi::CString::new(config.to_string()).map_err(|error| error.to_string())?;
    let status = unsafe { qualia_sdk_initialize(config.as_ptr()) };
    if status == 0 {
        Ok(())
    } else {
        Err(format!("resource engine init failed with status {}", status))
    }
}

#[cfg(not(feature = "resource-engine-sdk"))]
fn initialize_resource_engine(_operator_email: &str, _tier: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "resource-engine-sdk")]
fn shutdown_resource_engine() -> Result<(), String> {
    let status = unsafe { qualia_sdk_shutdown() };
    if status == 0 {
        Ok(())
    } else {
        Err(format!("resource engine shutdown failed with status {}", status))
    }
}

#[cfg(not(feature = "resource-engine-sdk"))]
fn shutdown_resource_engine() -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "resource-engine-sdk")]
fn record_resource_activity(bytes_used: u64) {
    let _ = unsafe { qualia_sdk_record_activity(bytes_used) };
}

#[cfg(not(feature = "resource-engine-sdk"))]
fn record_resource_activity(_bytes_used: u64) {}

fn emit_snapshot(app: &tauri::AppHandle, snapshot: RuntimeSnapshot) {
    let _ = app.emit("qualia://runtime", snapshot);
}

#[tauri::command]
fn start_shift(
    app: tauri::AppHandle,
    state: State<'_, Mutex<RuntimeState>>,
    operator_email: String,
    tier: String,
    consent_granted: bool,
) -> Result<ShiftStartResult, String> {
    if !consent_granted {
        return Err("Explicit resource-consent is required before a shift can start.".into());
    }

    initialize_resource_engine(&operator_email, &tier)?;

    let operator_id;
    let snapshot;
    {
        let mut runtime = state.lock().map_err(|_| "runtime lock poisoned")?;
        operator_id = build_operator_id(&operator_email);
        runtime.active = true;
        runtime.operator_email = Some(operator_email);
        runtime.operator_id = Some(operator_id.clone());
        runtime.tier = Some(tier);
        runtime.session_started_at = Some(Instant::now());
        runtime.accrued_seconds = 0;
        runtime.accuracy_index = if runtime.accuracy_index == 0.0 {
            99.14
        } else {
            runtime.accuracy_index
        };
        runtime.status_line = "SHIFT_ACTIVE".into();
        snapshot = snapshot_from(&runtime);
    }

    emit_snapshot(&app, snapshot.clone());
    Ok(ShiftStartResult { operator_id, snapshot })
}

#[tauri::command]
fn stop_shift(app: tauri::AppHandle, state: State<'_, Mutex<RuntimeState>>) -> Result<RuntimeSnapshot, String> {
    shutdown_resource_engine()?;

    let snapshot;
    {
        let mut runtime = state.lock().map_err(|_| "runtime lock poisoned")?;
        if let Some(started_at) = runtime.session_started_at {
            runtime.accrued_seconds += started_at.elapsed().as_secs();
        }
        runtime.active = false;
        runtime.session_started_at = None;
        runtime.system_resource_utilization = 0.0;
        runtime.status_line = "SHIFT_PAUSED".into();
        snapshot = snapshot_from(&runtime);
    }

    emit_snapshot(&app, snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn get_runtime_snapshot(state: State<'_, Mutex<RuntimeState>>) -> Result<RuntimeSnapshot, String> {
    let runtime = state.lock().map_err(|_| "runtime lock poisoned")?;
    Ok(snapshot_from(&runtime))
}

#[tauri::command]
fn record_review_outcome(
    app: tauri::AppHandle,
    state: State<'_, Mutex<RuntimeState>>,
    approved: bool,
    payout_cents: u32,
    accuracy_delta: f64,
) -> Result<RuntimeSnapshot, String> {
    let bytes_used = u64::from(payout_cents) * 1024 * 16;
    record_resource_activity(bytes_used);

    let snapshot;
    {
        let mut runtime = state.lock().map_err(|_| "runtime lock poisoned")?;
        if approved {
            runtime.today_approved += 1;
        } else {
            runtime.today_rejected += 1;
        }
        runtime.accuracy_index = (runtime.accuracy_index + accuracy_delta).clamp(92.0, 100.0);
        runtime.system_resource_utilization =
            (runtime.system_resource_utilization + f64::from(payout_cents) / 100.0).clamp(0.0, 100.0);
        runtime.work_stream_gb += bytes_used as f64 / 1_000_000_000.0;
        runtime.status_line = if approved {
            "REVIEW_ACCEPTED".into()
        } else {
            "REVIEW_ESCALATED".into()
        };
        snapshot = snapshot_from(&runtime);
    }

    emit_snapshot(&app, snapshot.clone());
    Ok(snapshot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(RuntimeState {
            accuracy_index: 99.14,
            status_line: "IDLE".into(),
            ..RuntimeState::default()
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_shift,
            stop_shift,
            get_runtime_snapshot,
            record_review_outcome
        ])
        .setup(|app| {
            let snapshot = {
                let state = app.state::<Mutex<RuntimeState>>();
                let runtime = state.lock().map_err(|_| "runtime lock poisoned")?;
                snapshot_from(&runtime)
            };
            emit_snapshot(app.handle(), snapshot);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
