// The desktop shell: one window with the app in it (the system's web view: WKWebView on the Mac). The app itself is
// the web app as it is in the repository (desktop/dist.mjs copies it here).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("PoopTracker couldn't start");
}
