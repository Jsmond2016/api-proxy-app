mod apifox;
mod commands;
mod model;
mod proxy;
mod state;

use commands::{
    clear_logs, clear_rules, create_profile, delete_local_response, delete_profile, delete_rule,
    delete_rules, generate_certificate, get_snapshot, move_rules, open_certificate,
    preview_mock_response, refresh_certificate, resolve_apifox_operation, save_local_response,
    save_rule, set_active_profile, set_all_rules_enabled, set_global_mock_enabled,
    set_rule_enabled, start_proxy, stop_proxy, sync_apifox, update_profile, validate_apifox,
};
use state::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            let state = AppState::load(data_directory)?;
            app.manage(state);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let has_active_profile = state
                    .snapshot
                    .lock()
                    .map(|snapshot| snapshot.active_profile_id.is_some())
                    .unwrap_or(false);
                if has_active_profile {
                    if let Err(error) = crate::proxy::ensure_proxy_running(&handle, &state).await {
                        let _ = handle.emit("proxy://startup-error", error);
                    }
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            create_profile,
            update_profile,
            delete_profile,
            set_active_profile,
            set_global_mock_enabled,
            set_rule_enabled,
            set_all_rules_enabled,
            save_rule,
            save_local_response,
            delete_local_response,
            delete_rule,
            delete_rules,
            move_rules,
            clear_rules,
            generate_certificate,
            refresh_certificate,
            open_certificate,
            start_proxy,
            stop_proxy,
            validate_apifox,
            sync_apifox,
            resolve_apifox_operation,
            clear_logs,
            preview_mock_response
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Apifox Proxy desktop application");
}
