/**
 * A last-resort, non-destructive notice for a window-level error
 * (specs/05-features.md F17).
 *
 * **Raw DOM on purpose, and outside the React root on purpose.** Its whole job
 * is to work when React may be broken, so it cannot be a component, and it must
 * never touch `#root` — writing there is what used to destroy the app and every
 * terminal in it.
 *
 * **This is a stopgap and should be deleted.** Roadmap item 7 brings a real
 * toast primitive to `@factorai/ui` and an `AppError` routing story; when it
 * lands, a *mounted* app should surface these through it and this file goes
 * away. It exists because the alternative today is `console.error` alone, and a
 * release build where unhandled rejections are invisible is how the Monaco
 * cancellation bug survived three releases.
 */

const HOST_ID = 'factorai-error-notice';

/** Coalesce repeats rather than stacking: one cancelled diff per click adds up
 *  fast, and twenty identical cards is worse than a count. */
const seen = new Map<string, number>();

export function showErrorNotice(text: string): void {
	const count = (seen.get(text) ?? 0) + 1;
	seen.set(text, count);

	const host = ensureHost();
	const existing = host.querySelector<HTMLElement>(`[data-msg="${cssEscape(text)}"]`);
	if (existing) {
		const badge = existing.querySelector<HTMLElement>('[data-count]');
		if (badge) badge.textContent = `×${count}`;
		return;
	}

	const card = document.createElement('div');
	card.dataset.msg = text;
	card.style.cssText = [
		'pointer-events:auto',
		'max-width:min(520px,90vw)',
		'max-height:40vh',
		'overflow:auto',
		'background:#1a1e24',
		'color:#d4d4d8',
		'border:1px solid #3a3f48',
		'border-radius:6px',
		'padding:10px 12px',
		'font:11px/1.5 ui-monospace,monospace',
		'white-space:pre-wrap',
		'box-shadow:0 6px 24px rgba(0,0,0,.45)',
	].join(';');

	const bar = document.createElement('div');
	bar.style.cssText =
		'display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#f0a4a4;font-weight:600';

	const title = document.createElement('span');
	title.textContent = 'Unexpected error';
	title.style.flex = '1';

	const badge = document.createElement('span');
	badge.dataset.count = '';
	badge.textContent = `×${count}`;
	badge.style.cssText = 'color:#8b919c;font-weight:400';

	const close = document.createElement('button');
	close.textContent = '✕';
	close.setAttribute('aria-label', 'Dismiss');
	close.style.cssText =
		'background:none;border:0;color:#8b919c;cursor:pointer;font:12px/1 monospace;padding:2px';
	close.onclick = () => {
		seen.delete(text);
		card.remove();
		if (!host.firstChild) host.remove();
	};

	bar.append(title, badge, close);
	const body = document.createElement('div');
	body.textContent = text;
	card.append(bar, body);
	host.append(card);
}

function ensureHost(): HTMLElement {
	const found = document.getElementById(HOST_ID);
	if (found) return found;
	const host = document.createElement('div');
	host.id = HOST_ID;
	// Bottom-right, above everything, and click-through except on the cards —
	// so it can never block the app it is reporting on.
	host.style.cssText = [
		'position:fixed',
		'right:12px',
		'bottom:12px',
		'z-index:2147483647',
		'display:flex',
		'flex-direction:column',
		'gap:8px',
		'align-items:flex-end',
		'pointer-events:none',
	].join(';');
	document.body.append(host);
	return host;
}

/** `CSS.escape` is not in WebKitGTK's older builds' typings path here, and the
 *  only characters that matter for an attribute selector are quotes and
 *  backslashes. */
function cssEscape(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
