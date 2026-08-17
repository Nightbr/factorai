import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	MARK_CORNER_RADIUS,
	MARK_F_FILL,
	MARK_F_PATH,
	MARK_HOUSING_FILL,
	MARK_PORT_DEPTH,
	MARK_PORT_HEIGHT,
	MARK_PORT_Y,
	MARK_SIZE,
} from './geometry';

/**
 * `geometry.ts` mirrors `docs/brand/factorai-icon.svg` by hand, and the favicon
 * is a copy of that same master. Both are duplication we accepted on purpose;
 * this is the check that makes the duplication safe rather than a slow leak.
 *
 * If this fails, fix the master first (`specs/09-branding.md` § B7) and then
 * bring the copies to it — never the other way round.
 */
const repoFile = (path: string) =>
	readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');

const MASTER = 'docs/brand/factorai-icon.svg';

describe('brand geometry', () => {
	const master = repoFile(MASTER);

	it('mirrors the F exactly as the master draws it', () => {
		expect(master).toContain(`d="${MARK_F_PATH}"`);
	});

	it('mirrors the housing size, corner radius and fills', () => {
		expect(master).toContain(`viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}"`);
		expect(master).toContain(`rx="${MARK_CORNER_RADIUS}"`);
		expect(master).toContain(`fill="${MARK_HOUSING_FILL}"`);
		expect(master).toContain(`fill="${MARK_F_FILL}"`);
	});

	it('mirrors every port, on both edges', () => {
		// Symmetry is the property that broke once already — an off-canvas offset
		// left the ports 1.1 cells deep on one side and 1.5 on the other.
		for (const y of MARK_PORT_Y) {
			expect(master).toContain(
				`<rect x="0" y="${y}" width="${MARK_PORT_DEPTH}" height="${MARK_PORT_HEIGHT}"/>`,
			);
			expect(master).toContain(
				`<rect x="${MARK_SIZE - MARK_PORT_DEPTH}" y="${y}" width="${MARK_PORT_DEPTH}" height="${MARK_PORT_HEIGHT}"/>`,
			);
		}
	});

	it('keeps the favicon byte-identical to the master', () => {
		expect(repoFile('apps/desktop/public/favicon.svg')).toBe(master);
	});
});
