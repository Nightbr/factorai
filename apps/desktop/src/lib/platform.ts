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
