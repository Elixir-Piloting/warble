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
        .invoke_handler(tauri::generate_handler![
            greet,
            tts::load_tts_model,
            tts::get_tts_voice_state,
            tts::generate_tts_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
