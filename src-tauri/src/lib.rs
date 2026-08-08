mod apifox;
mod commands;
mod model;
mod proxy;
mod state;

use commands::{
    generate_certificate, get_snapshot, set_active_profile, set_proxy_status, set_rule_enabled,
    start_proxy, stop_proxy, sync_openapi,
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
            set_proxy_status,
            set_active_profile,
            set_rule_enabled,
            generate_certificate,
            start_proxy,
            stop_proxy,
            sync_openapi
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Apifox Proxy desktop application");
}
