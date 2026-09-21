import { hostIsShowing } from '@components/viewer/viewerHost';
import { describe, expect, it } from 'vitest';

describe('hostIsShowing', () => {
	it('gives the modal the file while it is expanded, and the pane otherwise', () => {
		expect(hostIsShowing('modal', true)).toBe(true);
		expect(hostIsShowing('pane', true)).toBe(false);
		expect(hostIsShowing('pane', false)).toBe(true);
		expect(hostIsShowing('modal', false)).toBe(false);
	});

	it('never lets both hosts show at once, which is the bug it exists for', () => {
		// Two `FileView`s are mounted whenever the modal is open. If this ever
		// answered true twice, a video would decode twice and play two
		// soundtracks a few hundred milliseconds apart.
		for (const expanded of [true, false]) {
			const showing = (['pane', 'modal'] as const).filter((h) => hostIsShowing(h, expanded));
			expect(showing, `expanded=${expanded}`).toHaveLength(1);
		}
	});
});
