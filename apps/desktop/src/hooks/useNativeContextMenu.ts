import { useEffect } from 'react';

/**
 * Suppress the WebView's own context menu on the app's chrome — everywhere the
 * app is a desktop shell rather than a text field.
 *
 * **Measured, not assumed** (2026-08-16, WebKitGTK 2.52.3 / X11). Right-clicking
 * the panel header, the sidebar or any other chrome draws WebKit's *navigation*
 * menu: `Back · Forward · Stop · Reload · Inspect Element`. None of those mean
 * anything in a window with no address bar, and `Reload` is actively harmful —
 * it drops every pooled xterm and the whole renderer's state on the floor.
 *
 * **Two places keep the native menu, deliberately:**
 *
 * - **The embedded terminal.** Right-clicking it gives GTK's editable menu —
 *   `Cut · Copy · Paste · Select All` — and *pastes the clipboard into the
 *   prompt*. That is the only mouse-driven paste into a session today (F5's
 *   toolbar of "Copy selection / Search-in-terminal" was never built), so
 *   taking it away here would remove a capability under cover of a cosmetic
 *   fix. Whether the terminal should have its own menu is F5's question.
 * - **Real text fields** — the sidebar's search box and anything else you type
 *   into. Same reasoning, smaller stakes.
 *
 * A row that draws its own menu (the file tree's, F12) is already handled:
 * Radix calls `preventDefault` on its trigger. This listener runs afterwards on
 * the way up and preventing an already-prevented default costs nothing, so the
 * two do not have to know about each other.
 *
 * macOS is unverified — nobody has run this app on one (roadmap item 8). WKWebView
 * draws a different menu; the rule "chrome is not a document" holds either way.
 */
export function useNativeContextMenu(): void {
	useEffect(() => {
		function onContextMenu(e: MouseEvent) {
			const target = e.target;
			if (!(target instanceof Element)) return;
			// `closest` rather than a class check: a right-click on the terminal
			// can land on the screen layer, the selection layer or xterm's hidden
			// textarea, and all three sit under `.xterm`.
			if (target.closest('.xterm')) return;
			if (target.closest('input, textarea, [contenteditable="true"]')) return;
			e.preventDefault();
		}
		document.addEventListener('contextmenu', onContextMenu);
		return () => document.removeEventListener('contextmenu', onContextMenu);
	}, []);
}
