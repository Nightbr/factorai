import { describe, expect, it } from 'vitest';
import { type CrashContext, crashReport, issueUrl } from './crashReport';

function ctx(over: Partial<CrashContext> = {}): CrashContext {
	return {
		name: 'TypeError',
		message: "Cannot read properties of undefined (reading 'status')",
		componentStack: '\n    at SessionHeader (session.tsx:118)\n    at Shell\n',
		version: '0.1.0',
		userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15',
		...over,
	};
}

describe('crashReport', () => {
	it('carries what is needed to place the crash', () => {
		const body = crashReport(ctx());
		expect(body).toContain('TypeError: Cannot read properties of undefined');
		expect(body).toContain('at SessionHeader (session.tsx:118)');
		expect(body).toContain('factorai 0.1.0');
		expect(body).toContain('AppleWebKit');
	});

	it('says so rather than leaving a blank block when React gave no stack', () => {
		expect(crashReport(ctx({ componentStack: null }))).toContain('(unavailable)');
		// An all-whitespace stack is the same nothing, and must not produce an
		// empty fence either.
		expect(crashReport(ctx({ componentStack: '   \n  ' }))).toContain('(unavailable)');
	});
});

describe('issueUrl', () => {
	/** The rule the shell scope in tauri.conf.json enforces:
	 *  `https?://\w[^\s]*`. A single raw space and the click does nothing. */
	const SHELL_SCOPE = /^((mailto:|tel:)[\w+][^\s]*|https?:\/\/\w[^\s]*|\/[\w.][^\n]*)$/;

	it('produces a url the shell open scope accepts', () => {
		expect(issueUrl(ctx())).toMatch(SHELL_SCOPE);
	});

	it('survives the characters that would otherwise break the scope', () => {
		// Newlines, spaces, quotes, `#`, `&` — everything a real stack contains.
		const nasty = issueUrl(
			ctx({
				message: 'a "quoted" thing & a #hash',
				componentStack: 'line one\n    line two\n\ttabbed',
			}),
		);
		expect(nasty).toMatch(SHELL_SCOPE);
		expect(nasty).not.toMatch(/\s/);
	});

	it('points at the repo and prefills both fields', () => {
		const url = issueUrl(ctx());
		expect(url).toContain('https://github.com/Nightbr/factorai/issues/new?');
		expect(url).toContain('title=');
		expect(url).toContain('body=');
	});

	it('caps a runaway title', () => {
		const url = issueUrl(ctx({ message: 'x'.repeat(500) }));
		const title = new URL(url).searchParams.get('title') ?? '';
		expect(title.length).toBeLessThanOrEqual(120);
		// The body is not capped — that is where the detail belongs.
		expect((new URL(url).searchParams.get('body') ?? '').length).toBeGreaterThan(120);
	});
});
