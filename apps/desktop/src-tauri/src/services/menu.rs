//! The application menu, and the one accelerator it deliberately gives up.
//!
//! macOS only. AppKit consumes a menu accelerator before the webview ever sees
//! the key, so two of F28's bindings cannot be renderer hotkeys there: quitting,
//! and — until this module existed — closing a tab, because Tauri's **default**
//! menu binds `Cmd+W` to Close Window.
//!
//! So we own the menu. `Cmd+Q` stays where every Mac user expects it and runs
//! the *same* path as the window's close button, which is what keeps ADR-0020's
//! quit guard and `kill_all()` in the story. **Close Window moves to
//! `Cmd+Shift+W`**, which frees `Cmd+W` to reach the webview and be the tab
//! close two users asked for (ADR-0046).
//!
//! Replacing the default menu means the Edit submenu is ours to supply as well:
//! without it macOS loses `Cmd+C` / `Cmd+V` inside the webview, which is a far
//! worse regression than the one this file exists to fix.
//!
//! Linux has no menu bar here, and needs none: there the same two actions are
//! ordinary hotkeys in the renderer.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

/// Menu item ids, matched in [`on_menu_event`]. Both close the window rather
/// than exiting: the exit belongs to `CloseRequested`, which is the only place
/// that knows whether Claude is working.
pub const QUIT: &str = "factorai:quit";
pub const CLOSE_WINDOW: &str = "factorai:close-window";

/// Build the menu. Called from the builder, once, before the window exists.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
	let quit = MenuItemBuilder::with_id(QUIT, "Quit factorai").accelerator("Cmd+Q").build(app)?;
	// The move that this whole module is for. `Cmd+Shift+W` rather than no
	// accelerator at all, so closing the window from the keyboard is still
	// possible for somebody who has always done it that way.
	let close_window = MenuItemBuilder::with_id(CLOSE_WINDOW, "Close Window")
		.accelerator("Cmd+Shift+W")
		.build(app)?;

	let app_menu = SubmenuBuilder::new(app, "factorai")
		.about(None)
		.separator()
		.hide()
		.hide_others()
		.show_all()
		.separator()
		.item(&quit)
		.build()?;

	// Ours only because the default menu is gone. Every item here is predefined:
	// the webview's own editing commands are what these accelerators drive.
	let edit_menu = SubmenuBuilder::new(app, "Edit")
		.undo()
		.redo()
		.separator()
		.cut()
		.copy()
		.paste()
		.select_all()
		.build()?;

	let window_menu =
		SubmenuBuilder::new(app, "Window").minimize().separator().item(&close_window).build()?;

	MenuBuilder::new(app).items(&[&app_menu, &edit_menu, &window_menu]).build()
}

/// Both items ask the window to close, which lands in `CloseRequested`.
///
/// **Never `app.exit()`**: that skips the quit guard and `kill_all()`, which is
/// orphaned `claude` processes plus a confirmation nobody was shown.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
	if id != QUIT && id != CLOSE_WINDOW {
		return;
	}
	if let Some(window) = app.get_webview_window("main") {
		let _ = window.close();
	}
}
