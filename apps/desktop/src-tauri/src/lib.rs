use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tracing_subscriber::fmt()
		.with_env_filter(
			tracing_subscriber::EnvFilter::try_from_default_env()
				.unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,factorai_lib=debug")),
		)
		.init();

	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|app| {
			#[cfg(debug_assertions)]
			if let Some(window) = app.get_webview_window("main") {
				window.open_devtools();
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running factorai");
}
