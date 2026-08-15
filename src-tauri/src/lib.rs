// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod store;
mod tts;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(tts::TtsState::default())
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            app.manage(store::Store::init(dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            tts::load_tts_model,
            tts::get_tts_voice_state,
            tts::generate_tts_stream,
            tts::generate_tts_preview,
            tts::cancel_generation,
            store::clone_voice,
            store::list_custom_voices,
            store::get_custom_voice,
            store::rename_custom_voice,
            store::delete_custom_voice,
            store::list_history,
            store::get_history,
            store::get_history_audio,
            store::delete_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
