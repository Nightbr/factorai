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

/**
 * Message text → its card, so repeats become a count instead of a stack.
 *
 * A `Map` rather than looking the card up in the DOM by its text: the text is a
 * multi-line stack trace, and `querySelector('[data-msg="…"]')` on it throws
 * `SyntaxError` — which, in a function called *from the error handler*, fed
 * itself straight back in through the `error` listener. Caught by
 * `tests/smoke/global-errors.spec.ts` before it shipped.
 */
const cards = new Map<string, { card: HTMLElement; badge: HTMLElement; count: number }>();

export function showErrorNotice(text: string): void {
	const existing = cards.get(text);
	if (existing) {
		existing.count += 1;
		existing.badge.textContent = `×${existing.count}`;
		return;
	}

	const host = ensureHost();

	const card = document.createElement('div');
	card.dataset.notice = '';
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
	badge.textContent = '×1';
	badge.style.cssText = 'color:#8b919c;font-weight:400';

	const close = document.createElement('button');
	close.textContent = '✕';
	close.setAttribute('aria-label', 'Dismiss');
	close.style.cssText =
		'background:none;border:0;color:#8b919c;cursor:pointer;font:12px/1 monospace;padding:2px';
	close.onclick = () => {
		cards.delete(text);
		card.remove();
		if (!host.firstChild) host.remove();
	};

	bar.append(title, badge, close);
	const body = document.createElement('div');
	// textContent, never innerHTML: the text is an error message and may contain
	// anything, including a path or a payload with markup in it.
	body.textContent = text;
	card.append(bar, body);
	host.append(card);
	cards.set(text, { card, badge, count: 1 });
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
