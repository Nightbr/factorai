import { describe, expect, it } from 'vitest';
import { authorInitials, avatarColour, avatarFor, avatarInk } from './avatar';

describe('avatarColour', () => {
	it('is stable for the same identity', () => {
		expect(avatarColour('ada@example.com')).toBe(avatarColour('ada@example.com'));
	});

	it('separates different identities', () => {
		// Not a guarantee for any two strings — 12 hues means collisions exist —
		// but these two must not be one of them, or the fixture is lying.
		expect(avatarColour('ada@example.com')).not.toBe(avatarColour('grace@example.com'));
	});

	it('stays inside the one lightness and chroma the set is drawn at', () => {
		for (const email of ['a@b.c', 'ada@example.com', '', 'x'.repeat(200)]) {
			expect(avatarColour(email)).toMatch(/^oklch\(45% 0\.09 \d+(\.\d+)?\)$/);
		}
	});
});

describe('avatarInk', () => {
	it("shares the fill's hue, so the pair reads as one disc", () => {
		for (const email of ['a@b.c', 'ada@example.com', '', 'x'.repeat(200)]) {
			const hue = (h: string) => h.match(/ (\d+(?:\.\d+)?)\)$/)?.[1];
			expect(hue(avatarInk(email))).toBe(hue(avatarColour(email)));
		}
	});

	it('is far enough from the fill to carry initials in either theme', () => {
		// The point of not using `--card`: the contrast between disc and initials
		// has to be a property of `avatar.ts`, not of whichever theme is mounted.
		//
		// **Absolute distance, not a signed one.** The ink was darker than the fill
		// while the disc was pastel and is lighter now that it is dark, and both
		// are correct — what the drawing needs is 50 points of oklch lightness
		// between them, whichever side they fall on. A signed assertion would have
		// to be rewritten every time the disc is retuned, which is the same trap
		// as pinning the ink to a theme token.
		const lightness = (c: string) => Number(c.match(/^oklch\((\d+(?:\.\d+)?)%/)?.[1]);
		for (const email of ['a@b.c', 'ada@example.com', '', 'x'.repeat(200)]) {
			const gap = Math.abs(lightness(avatarColour(email)) - lightness(avatarInk(email)));
			expect(gap).toBeGreaterThanOrEqual(50);
		}
	});
});

describe('authorInitials', () => {
	it('takes the first letter of the first two words', () => {
		expect(authorInitials('Ada Lovelace', 'ada@example.com')).toBe('AL');
		expect(authorInitials('Ada Byron Lovelace', 'ada@example.com')).toBe('AB');
	});

	it('splits on the separators a bot name uses instead of spaces', () => {
		expect(authorInitials('dependabot[bot]', 'x@y.z')).toBe('DE');
		expect(authorInitials('release-bot', 'x@y.z')).toBe('RB');
		expect(authorInitials('build.agent', 'x@y.z')).toBe('BA');
	});

	it('falls back to the email local part when there is no name', () => {
		expect(authorInitials('', 'grace@example.com')).toBe('GR');
		expect(authorInitials('   ', 'grace@example.com')).toBe('GR');
	});

	it('never returns an empty label', () => {
		// A commit with neither a name nor an email is malformed, but git will
		// hand one over and the node still has to draw something.
		expect(authorInitials('', '')).toBe('?');
	});
});

describe('avatarFor', () => {
	it('keys off the email, so one author renaming themselves keeps their colour', () => {
		const before = avatarFor('Ada Lovelace', 'ada@example.com');
		const after = avatarFor('A. Lovelace', 'ada@example.com');
		expect(after.colour).toBe(before.colour);
	});

	it('falls back to the name when there is no email at all', () => {
		const a = avatarFor('Ada Lovelace', '');
		expect(a.colour).toBe(avatarColour('ada lovelace'));
		expect(a.ink).toBe(avatarInk('ada lovelace'));
		expect(a.initials).toBe('AL');
	});
});
