/**
 * Window-level `error` / `unhandledrejection` handling — the failures no React
 * error boundary can see (specs/05-features.md F17).
 *
 * A boundary catches throws during **render**. It cannot catch an event
 * handler, a `setTimeout`, or a rejected promise, because none of those happen
 * inside React's render phase. So those need a handler here, outside React —
 * and what that handler does matters enormously, because it is the last thing
 * standing between a stray rejection and the user's session.
 *
 * The classification below is pure and exported so it can be tested without a
 * DOM; `installGlobalErrorHandlers` is the thin wiring around it.
 */

/**
 * Monaco cancels in-flight worker requests when an editor or model is
 * disposed, and rejects them with a `CancellationError`. **This is not an
 * error**, and Monaco's own `onUnexpectedError` drops it on the floor for
 * exactly that reason ("ignore errors from cancelled promises" —
 * `vs/base/common/errors.js`).
 *
 * We see it because `DiffView` disposes its diff editor whenever the commit,
 * file or side-by-side mode changes, and `createDiffEditor` computes the diff
 * in a worker. Clicking through commits in the Graph tab cancels a pending
 * diff every time — which is normal, and used to blank the entire app.
 *
 * The shape is matched rather than the class imported: this module must not
 * pull Monaco into the main bundle (it lives behind the lazy viewer chunk,
 * ADR-0007), and the class is stable — upstream marks it
 * `!!!IMPORTANT!!! Do NOT change this class because it is also used as an
 * API-type` and tests the same three fields itself.
 */
export function isCancellation(err: unknown): boolean {
	return err instanceof Error && err.name === 'Canceled' && err.message === 'Canceled';
}

/** Human-readable text for anything that can be thrown or rejected. */
export function describeError(err: unknown): string {
	if (err instanceof Error) {
		return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
	}
	// A rejection can carry anything, including our own `AppError` tagged union.
	if (err && typeof err === 'object') {
		try {
			return JSON.stringify(err);
		} catch {
			// Circular, or a getter that throws. String() is the honest fallback.
		}
	}
	return String(err);
}

/** What a global failure should do, once classified. */
type ErrorDisposition =
	| { kind: 'ignore'; why: string }
	| { kind: 'boot-failure'; text: string }
	| { kind: 'runtime'; text: string };

/**
 * Decide what a window-level failure means.
 *
 * `mounted` is the load-bearing input, and it is asked of the DOM rather than
 * tracked with a flag: if React has put anything on the page, the app is up and
 * a stray rejection must **not** take it down. Only a failure with nothing
 * rendered at all is a boot failure, and only then is replacing the document
 * the right response — there is nothing to preserve and no other way to say so.
 *
 * This is the bug this module exists to fix. The handler it replaces
 * (`root.innerHTML = …`, from the M0 scaffold) treated every failure as a boot
 * failure, so a benign Monaco cancellation destroyed the React tree and every
 * live terminal in it.
 */
export function classify(err: unknown, mounted: boolean): ErrorDisposition {
	if (isCancellation(err)) {
		return { kind: 'ignore', why: 'monaco cancelled an in-flight worker request' };
	}
	// A failed resource load (an `<img>`, a stylesheet) also fires `error` on
	// window, as a plain Event carrying neither `error` nor `message`. Reporting
	// that renders a card reading "undefined", which says nothing and trains you
	// to dismiss the ones that matter.
	if (err === undefined || err === null || err === '') {
		return { kind: 'ignore', why: 'event carried no error or message' };
	}
	const text = describeError(err);
	return mounted ? { kind: 'runtime', text } : { kind: 'boot-failure', text };
}

interface GlobalErrorHooks {
	/** Has React rendered anything yet? */
	isMounted: () => boolean;
	/** Nothing rendered — show this instead, by whatever means. */
	onBootFailure: (text: string) => void;
	/** App is alive; surface this without disturbing it. */
	onRuntimeError: (text: string) => void;
}

/** Wire both window listeners. Returns a teardown — unused by `main.tsx`, which
 *  wants them for the process lifetime, but the listeners are removable rather
 *  than permanent so this is not a leak by construction. */
export function installGlobalErrorHandlers(hooks: GlobalErrorHooks): () => void {
	// A reporting failure must never feed itself back in. `showErrorNotice` threw
	// a SyntaxError on its first implementation, which fired the `error` listener,
	// which called it again — an error handler that is its own error source is
	// unfixable from the inside, so the recursion is cut here rather than trusted
	// not to happen.
	let reporting = false;

	const handle = (label: string, err: unknown) => {
		const d = classify(err, hooks.isMounted());
		if (d.kind === 'ignore') {
			// Not silent — findable in DevTools — but never on screen.
			console.debug(`[factorai] ignored ${label}: ${d.why}`);
			return;
		}
		// console.error first and unguarded: whatever else fails, the error itself
		// reaches DevTools.
		console.error(`[factorai] ${label}`, err);
		if (reporting) return;
		reporting = true;
		try {
			if (d.kind === 'boot-failure') hooks.onBootFailure(`[${label}] ${d.text}`);
			else hooks.onRuntimeError(`[${label}] ${d.text}`);
		} catch (reportErr) {
			console.error('[factorai] error handler itself failed', reportErr);
		} finally {
			reporting = false;
		}
	};

	const onError = (e: ErrorEvent) => handle('error', e.error ?? e.message);
	const onRejection = (e: PromiseRejectionEvent) => handle('unhandledrejection', e.reason);

	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
	};
}
