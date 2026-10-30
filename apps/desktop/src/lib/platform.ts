/// Which OS the webview is running on, from the user agent rather than from
/// `@tauri-apps/plugin-os`: the only thing this answers is a styling question
/// (see `AppShell`), it has to answer it on the first paint, and under
/// `pnpm vite:dev` there is no plugin to ask. WebKitGTK and WKWebView both
/// report the host platform honestly, so the sniff is reliable here in a way
/// it never is on the open web.
export function isMacOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	return navigator.userAgent.includes('Mac OS X');
}

/// The menu label for `reveal_in_file_manager`, in the platform's own words:
/// a control named something other than the item a reader already knows from
/// their OS is one they have to read twice (specs/05-features.md F7).
export function revealLabel(): string {
	return isMacOS() ? 'Reveal in Finder' : 'Reveal in file manager';
}
