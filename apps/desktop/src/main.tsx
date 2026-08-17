import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { showErrorNotice } from '@lib/errorNotice';
import { installGlobalErrorHandlers } from '@lib/globalErrors';
import { App } from './App';
import './styles/globals.css';

const found = document.getElementById('root');
if (!found) throw new Error('Root element not found');
// Rebound after the guard: `showBootFailure` is hoisted above it, and TS will
// not carry the null-narrowing of a module-level binding into a function body.
const root: HTMLElement = found;

/**
 * The full-screen fallback, for the one case that earns it: nothing rendered at
 * all. Then there is nothing to preserve, and replacing the document is the
 * only way to say anything.
 *
 * **It is no longer reached by every stray rejection**, which is what it did
 * from the M0 scaffold until 2026-08-17 — including for Monaco's benign
 * cancellations, so a click in the Graph tab could blank the app and take every
 * live terminal with it. `classify()` in `lib/globalErrors` decides; see F17.
 */
function showBootFailure(text: string): void {
	root.innerHTML = `<pre style="color:#fff;background:#900;padding:16px;font:12px monospace;white-space:pre-wrap;">${escapeHtml(text)}</pre>`;
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
	);
}

installGlobalErrorHandlers({
	// Asked of the DOM rather than tracked with a flag: if React has painted
	// anything, the app is up and must survive.
	isMounted: () => root.childElementCount > 0,
	onBootFailure: showBootFailure,
	onRuntimeError: showErrorNotice,
});

try {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
} catch (err) {
	// Synchronous throw out of render — React never got as far as a boundary.
	showBootFailure(`[render] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
}
