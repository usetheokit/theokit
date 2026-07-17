use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the live sidecar child so `approve` can write the HITL decision to its stdin.
#[derive(Default)]
struct SidecarState(Mutex<Option<CommandChild>>);

fn decision_line(approval_id: &str, approved: bool) -> String {
    format!(
        "{}\n",
        serde_json::json!({ "approvalId": approval_id, "approved": approved })
    )
}

/// Run one agent turn: spawn the Node sidecar with the message, stream its stdout (JSONL chunks) to
/// the webview over a `Channel<String>` (the push transport, ADR-0045 D3). Kills any in-flight sidecar.
#[tauri::command]
async fn run_turn(
    app: tauri::AppHandle,
    message: String,
    on_chunk: Channel<String>,
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("theo-sidecar")
        .map_err(|e| e.to_string())?
        // Forward this process's environment (the provider key — OPENROUTER_API_KEY /
        // ANTHROPIC_API_KEY — lives here) so the sidecar can authenticate.
        .envs(std::env::vars())
        .args([message])
        .spawn()
        .map_err(|e| e.to_string())?;

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(old) = guard.take() {
            let _ = old.kill();
        }
        *guard = Some(child);
    }

    // AWAIT the stream inline — do NOT spawn a detached task and return early. The webview's
    // `ChannelTransport` calls `invoke('run_turn').then(onClose)`, and `onClose` CLOSES the stream
    // (further chunks are dropped). If `run_turn` resolves before the sidecar's chunks are delivered
    // over the Channel, every chunk lands after the stream is closed → the agent renders no reply.
    // Resolving only after the sidecar terminates makes `onClose` fire AFTER the last chunk. HITL is
    // unaffected: `approve` writes to the child's stdin via shared state while this loop awaits.
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                let _ = on_chunk.send(line);
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(())
}

/// Forward a human approve/deny decision to the sidecar's stdin (the HITL round-trip).
#[tauri::command]
fn approve(
    approval_id: String,
    approved: bool,
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    let line = decision_line(&approval_id, approved);
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        child.write(line.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![run_turn, approve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
