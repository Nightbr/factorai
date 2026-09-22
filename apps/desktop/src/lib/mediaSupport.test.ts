import { mediaStackIsMissing, resetMediaSupportCache } from '@lib/mediaSupport';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The vitest environment is `node`, so there is no `document` — which is the
 * point: every case here installs the one it wants and the absence of one is
 * itself a case.
 */
function withCanPlayType(answer: (type: string) => string): void {
	vi.stubGlobal('document', {
		createElement: () => ({ canPlayType: answer }),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	resetMediaSupportCache();
});

describe('mediaStackIsMissing', () => {
	it('says the stack is gone when nothing at all is playable', () => {
		// Measured against a WebKitGTK 4.1 view with its plugin path pointed at
		// an empty directory: every type answers empty, because the MIME
		// registry is built from plugins and there are none.
		withCanPlayType(() => '');
		expect(mediaStackIsMissing()).toBe(true);
	});

	it('says nothing is wrong when the webview answers for anything', () => {
		withCanPlayType((type) => (type === 'video/webm' ? 'maybe' : ''));
		expect(mediaStackIsMissing()).toBe(false);
	});

	it('does not ground a container the demuxer handles but canPlayType denies', () => {
		// The regression this guards: `.mkv` answers empty on a perfectly healthy
		// WebKitGTK and plays anyway (ADR-0057). A check that looked at the
		// *file's* type would refuse the one format F7 exists to play — so this
		// one never sees the file's type at all, and a build that can play mp4
		// is a build that mounts the element for everything.
		withCanPlayType((type) => (type.startsWith('video/mp4') ? 'probably' : ''));
		expect(mediaStackIsMissing()).toBe(false);
	});

	it('fails open when there is no document to ask', () => {
		// A guard that grounds every video on its own bug is worse than the
		// failure it guards against.
		expect(mediaStackIsMissing()).toBe(false);
	});

	it('fails open when asking throws', () => {
		vi.stubGlobal('document', {
			createElement: () => {
				throw new Error('no elements here');
			},
		});
		expect(mediaStackIsMissing()).toBe(false);
	});

	it('asks once and remembers, because plugins do not arrive mid-run', () => {
		const canPlayType = vi.fn(() => '');
		vi.stubGlobal('document', { createElement: () => ({ canPlayType }) });

		expect(mediaStackIsMissing()).toBe(true);
		const afterFirst = canPlayType.mock.calls.length;
		expect(mediaStackIsMissing()).toBe(true);
		expect(canPlayType.mock.calls.length).toBe(afterFirst);
	});
});
