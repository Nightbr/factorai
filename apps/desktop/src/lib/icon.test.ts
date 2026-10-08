import { describe, expect, it } from 'vitest';
import {
	PROJECT_HUES,
	PROJECT_SWATCH_COUNT,
	assignProjectSwatches,
	pickInitials,
	projectSwatch,
} from './icon';

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
		// 30 swatches and 600 names: a hash that skipped one would be a palette
		// smaller than it claims.
		const seen = new Set<string>();
		for (let i = 0; i < 600; i++) seen.add(projectSwatch(`project-${i}`).fill);
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

describe('assignProjectSwatches', () => {
	const project = (name: string, id = `id-${name}`) => ({ id, displayName: name });

	it('gives two colliding names different tiles', () => {
		// The report that led to ADR-0073 was a pair sharing one of 22 slots; at
		// 30 this pair shares one, and the point is the same.
		const a = projectSwatch('zack-health-planner');
		const b = projectSwatch('factorai');
		expect(a).toEqual(b);
		const assigned = assignProjectSwatches([project('zack-health-planner'), project('factorai')]);
		expect(assigned.get('zack-health-planner')).not.toEqual(assigned.get('factorai'));
	});

	it('never repeats a tile while the palette has room', () => {
		const projects = Array.from({ length: PROJECT_SWATCH_COUNT }, (_, i) =>
			project(`project-${i}`),
		);
		const fills = [...assignProjectSwatches(projects).values()].map((s) => s.fill);
		expect(new Set(fills).size).toBe(PROJECT_SWATCH_COUNT);
	});

	it('bumps a collider to a different hue, not the neighbouring one', () => {
		const assigned = assignProjectSwatches([project('zack-health-planner'), project('factorai')]);
		const hueOf = (c: string) => Number(c.match(/ (\d+(?:\.\d+)?)\)$/)?.[1]);
		const [a, b] = [
			hueOf(assigned.get('zack-health-planner')?.fill ?? ''),
			hueOf(assigned.get('factorai')?.fill ?? ''),
		];
		const ia = PROJECT_HUES.indexOf(a as (typeof PROJECT_HUES)[number]);
		const ib = PROJECT_HUES.indexOf(b as (typeof PROJECT_HUES)[number]);
		expect(Math.abs(ia - ib)).toBeGreaterThan(1);
	});

	it('draws the hashed tile for a project nothing collides with', () => {
		// So the stand-in `ProjectIcon` paints before the list arrives is, for
		// most projects, the tile it will keep.
		const assigned = assignProjectSwatches([project('encore'), project('perso')]);
		expect(assigned.get('encore')).toEqual(projectSwatch('encore'));
	});

	it('does not care about the order projects arrive in', () => {
		const list = [
			project('zack-health-planner'),
			project('docker-nbcorp-server'),
			project('perso'),
		];
		const forward = assignProjectSwatches(list);
		const backward = assignProjectSwatches([...list].reverse());
		for (const [key, swatch] of forward) expect(backward.get(key)).toEqual(swatch);
	});

	it('bumps the later project by id, so the one the user already learned stays', () => {
		const older = project('zack-health-planner', '0000-older');
		const newer = project('factorai', 'ffff-newer');
		const assigned = assignProjectSwatches([newer, older]);
		expect(assigned.get('zack-health-planner')).toEqual(projectSwatch('zack-health-planner'));
		expect(assigned.get('factorai')).not.toEqual(projectSwatch('factorai'));
	});

	it('folds two projects with one name into one tile', () => {
		const assigned = assignProjectSwatches([project('Factorai', 'a'), project('factorai ', 'b')]);
		expect(assigned.size).toBe(1);
		expect(assigned.get('factorai')).toEqual(projectSwatch('factorai'));
	});

	it('keeps the hashed slot once the palette is full rather than looping', () => {
		const projects = Array.from({ length: PROJECT_SWATCH_COUNT + 5 }, (_, i) =>
			project(`project-${i}`),
		);
		const assigned = assignProjectSwatches(projects);
		expect(assigned.size).toBe(PROJECT_SWATCH_COUNT + 5);
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
