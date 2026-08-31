/**
 * The text of a crash report, and the prefilled issue URL that carries it.
 *
 * Pure and in `lib/` rather than inside `ErrorBoundary.tsx` for one reason:
 * these are the only parts of the crash path with anything to get wrong, and
 * this way they are testable in the node environment without rendering a
 * broken React tree or pulling in Monaco's neighbours. Everything the
 * functions need is a parameter — nothing reads `navigator` or a build global.
 */

/** Where `Report an issue` goes. The repo is public; the URL is prefilled and
 *  opened in the browser, never submitted for the user. */
const ISSUES_URL = 'https://github.com/Nightbr/factorai/issues/new';

/** GitHub rejects a title over 256 chars; leave room and keep it scannable. */
const MAX_TITLE = 120;

export interface CrashContext {
	name: string;
	message: string;
	/** React's `ErrorInfo.componentStack`. Null when React did not supply one. */
	componentStack: string | null;
	/** The app version, from the build. */
	version: string;
	/** `navigator.userAgent` — tells a WebKitGTK bug from a macOS one. */
	userAgent: string;
}

/**
 * The report body, as markdown.
 *
 * Deliberately small: what broke, where, and enough about the build to place
 * it. Nothing is collected that the user has not already read on screen — this
 * project ships no telemetry, and this is not an exception to it. The user reads
 * this, edits it, and sends it by hand, or does not send it.
 */
export function crashReport(ctx: CrashContext): string {
	return [
		'**What happened**',
		'',
		'```',
		`${ctx.name}: ${ctx.message}`,
		'```',
		'',
		'**Component stack**',
		'',
		'```',
		ctx.componentStack?.trim() || '(unavailable)',
		'```',
		'',
		'**Environment**',
		'',
		`- factorai ${ctx.version}`,
		`- ${ctx.userAgent}`,
	].join('\n');
}

/**
 * The prefilled issue URL.
 *
 * `encodeURIComponent` is load-bearing rather than tidiness: the shell scope in
 * `tauri.conf.json` is `https?://\w[^\s]*`, so a URL carrying a raw space or
 * newline fails the plugin's regex validation and the click silently does
 * nothing at all. Encoding turns them into `%20` / `%0A`. Both halves are
 * guarded — this function by `crashReport.test.ts`, the scope itself by
 * `src-tauri/tests/shell_open_scope.rs`.
 */
export function issueUrl(ctx: CrashContext): string {
	const title = encodeURIComponent(`Crash: ${ctx.name}: ${ctx.message}`.slice(0, MAX_TITLE));
	const body = encodeURIComponent(crashReport(ctx));
	return `${ISSUES_URL}?title=${title}&body=${body}`;
}
