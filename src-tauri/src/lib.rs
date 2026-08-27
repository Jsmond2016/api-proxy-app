mod apifox;
mod commands;
mod model;
mod proxy;
mod state;

use commands::{
    clear_logs, clear_rules, create_profile, delete_profile, delete_rule, generate_certificate,
    get_snapshot, open_certificate, refresh_certificate, resolve_apifox_operation, save_rule,
    set_active_profile, set_global_mock_enabled, set_rule_enabled, start_proxy, stop_proxy,
    sync_apifox, update_profile, validate_apifox,
};
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            let state = AppState::load(data_directory)?;
            app.manage(state);
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
            save_rule,
            delete_rule,
            clear_rules,
            generate_certificate,
            refresh_certificate,
            open_certificate,
            start_proxy,
            stop_proxy,
            validate_apifox,
            sync_apifox,
            resolve_apifox_operation,
            clear_logs
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Apifox Proxy desktop application");
}
