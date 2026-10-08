import { describe, expect, it } from 'vitest';
import { PROJECT_HUES, PROJECT_SWATCH_COUNT, pickInitials, projectSwatch } from './icon';

const hueOf = (c: string) => Number(c.match(/ (\d+(?:\.\d+)?)\)$/)?.[1]);
const lightnessOf = (c: string) => Number(c.match(/^oklch\((\d+(?:\.\d+)?)%/)?.[1]);

describe('projectSwatch', () => {
	it('is deterministic', () => {
		expect(projectSwatch('factorai')).toEqual(projectSwatch('factorai'));
	});

	it('keys on the name the human reads, folding case and whitespace', () => {
		// ADR-0072: the same project in two checkouts draws the same tile, and a
		// rename that only changes case is not a new project.
		expect(projectSwatch('Factorai ')).toEqual(projectSwatch('factorai'));
	});

	it('only ever draws one of the palette hues', () => {
		const samples = ['', 'a', 'factorai', 'hey-pearl', 'something-with-many-dashes-in-it', '-'];
		for (const s of samples) {
			const { fill, ink } = projectSwatch(s);
			expect(PROJECT_HUES).toContain(hueOf(fill));
			expect(hueOf(ink)).toBe(hueOf(fill));
		}
	});

	it('keeps the amber band empty', () => {
		// The One Amber Rule (DESIGN.md): the waiting badge sits on this tile's
		// corner, so the tile itself must never be the colour that means "your
		// turn". Factorio Amber is hue 75.
		for (const h of PROJECT_HUES) expect(Math.abs(h - 75)).toBeGreaterThanOrEqual(25);
	});

	it('puts enough lightness between fill and ink to carry initials', () => {
		// The pair is a property of this file, not of the theme: neither value is
		// a token, so the contrast is the same under both themes.
		for (const s of ['', 'a', 'factorai', 'hey-pearl', 'x'.repeat(200)]) {
			const { fill, ink } = projectSwatch(s);
			expect(Math.abs(lightnessOf(fill) - lightnessOf(ink))).toBeGreaterThanOrEqual(40);
		}
	});

	it('reaches every swatch, not a lucky subset', () => {
		// 22 swatches and 400 names: a hash that skipped one would be a palette
		// smaller than it claims.
		const seen = new Set<string>();
		for (let i = 0; i < 400; i++) seen.add(projectSwatch(`project-${i}`).fill);
		expect(seen.size).toBe(PROJECT_SWATCH_COUNT);
	});

	it('spreads a sidebar of projects across the palette', () => {
		// Not a hard guarantee — a hash to 22 slots collides — but the complaint
		// this palette answers was a sidebar of ten projects in two colours, so
		// ten names landing on fewer than six tiles would be that bug back.
		const names = [
			'perso',
			'encore',
			'elixir',
			'comptoir',
			'anglemort',
			'nowhere',
			'liive',
			'tchou',
			'leguizeen',
			'infra',
		];
		const tiles = new Set(names.map((n) => projectSwatch(n).fill));
		expect(tiles.size).toBeGreaterThanOrEqual(6);
	});
});

describe('pickInitials', () => {
	it('takes one letter from each of the first two words', () => {
		expect(pickInitials('factor ai')).toBe('FA');
	});

	it('handles hyphen-separated names', () => {
		expect(pickInitials('hey-pearl')).toBe('HP');
	});

	it('handles underscore-separated names', () => {
		expect(pickInitials('snake_case_thing')).toBe('SC');
	});

	it('uses first two chars when single word', () => {
		expect(pickInitials('factorai')).toBe('FA');
	});

	it('strips leading -/_/. (encoded dir names)', () => {
		expect(pickInitials('-Users-alice-code-foo')).toBe('UA');
	});

	it('returns "?" for empty', () => {
		expect(pickInitials('')).toBe('?');
		expect(pickInitials('---')).toBe('?');
	});

	it('uppercases', () => {
		expect(pickInitials('lowercase')).toBe('LO');
	});
});
