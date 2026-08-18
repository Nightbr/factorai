import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Geometry of the project avatar and its status badge (F1).
 *
 * Asserted in pixels rather than by eye: the bug these guard against — an
 * inline-level tile sitting on a line box inside its wrapper, so the avatar and
 * its absolutely-positioned badge answer to different rectangles — is a couple
 * of pixels, invisible at 1x and obvious at 10x.
 */
async function boxes(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Expand zulu' }).click();
	await page.getByRole('link', { name: /Zulu task 11/ }).click();
	await expect(page.locator('.xterm')).toBeVisible();

	const icon = page
		.locator('aside')
		.getByTestId('project-icon')
		.filter({ has: page.locator('[title="Working"]') })
		.first();

	return icon.evaluate((el) => {
		const rect = (n: Element) => {
			const r = n.getBoundingClientRect();
			return {
				left: r.left,
				right: r.right,
				top: r.top,
				bottom: r.bottom,
				w: r.width,
				h: r.height,
			};
		};
		const tile = el.querySelector('[data-testid="project-icon-tile"]');
		const dot = el.querySelector('[title="Working"]');
		if (!tile || !dot) throw new Error('missing tile or badge');
		return { wrapper: rect(el), tile: rect(tile), dot: rect(dot) };
	});
}

test.describe('project icon', () => {
	test('@smoke the tile fills its wrapper exactly — no baseline shift', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		const { wrapper, tile } = await boxes(page);

		// The inline-block version pushed the tile ~2px down inside the wrapper.
		expect(tile.top).toBeCloseTo(wrapper.top, 1);
		expect(tile.bottom).toBeCloseTo(wrapper.bottom, 1);
		expect(tile.left).toBeCloseTo(wrapper.left, 1);
		expect(tile.right).toBeCloseTo(wrapper.right, 1);
	});

	test('@smoke the badge sits on the corner: half out right, ~45% out top', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		const { tile, dot } = await boxes(page);

		// Exactly half the badge's width hangs past the right edge.
		expect(dot.left + dot.w / 2).toBeCloseTo(tile.right, 1);

		// And 40–50% of its height above the top edge — a proportion of the badge,
		// not a pixel offset, so it holds at any avatar size.
		const above = tile.top - dot.top;
		expect(above / dot.h).toBeGreaterThanOrEqual(0.4);
		expect(above / dot.h).toBeLessThanOrEqual(0.5);
	});

	test('@smoke the overflowing badge does not move the row', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		// A badged row and a plain one must have identical geometry: the badge is
		// absolutely positioned, so overflowing it cannot grow the wrapper or
		// shift the avatar's baseline.
		const heights = await page.locator('aside li > div').evaluateAll((rows) =>
			rows.slice(0, 2).map((row) => {
				const icon = row.querySelector('[data-testid="project-icon"]');
				const r = (icon as Element).getBoundingClientRect();
				return { h: +r.height.toFixed(1), rowH: +row.getBoundingClientRect().height.toFixed(1) };
			}),
		);

		expect(heights[0]?.h).toBe(heights[1]?.h);
		expect(heights[0]?.rowH).toBe(heights[1]?.rowH);
	});

	test('@smoke the avatar is centred in its row', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		const centres = await page
			.locator('aside li > div')
			.first()
			.evaluate((row) => {
				const mid = (n: Element) => {
					const r = n.getBoundingClientRect();
					return r.top + r.height / 2;
				};
				const icon = row.querySelector('[data-testid="project-icon"]');
				const name = icon?.nextElementSibling;
				if (!icon || !name) throw new Error('missing icon or name');
				return { row: mid(row), icon: mid(icon), name: mid(name) };
			});

		expect(centres.icon).toBeCloseTo(centres.row, 0);
		expect(centres.icon).toBeCloseTo(centres.name, 0);
	});
});
