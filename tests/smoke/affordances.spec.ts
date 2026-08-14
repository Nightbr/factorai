import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * House rules for interactive affordances (AGENTS.md § Design rules): every
 * clickable thing gets a pointer, and an icon button never paints a background
 * — its hover state is the icon taking colour.
 */

test('@smoke clickable elements resolve to cursor:pointer', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');

	const cursorOf = (sel: string) =>
		page.locator(sel).first().evaluate((el) => getComputedStyle(el).cursor);

	// A hand-rolled control, a primitive-backed one, and a link.
	expect(await cursorOf('button[aria-label^="Pin "]')).toBe('pointer');
	expect(await cursorOf('button[aria-label="Sort and expand projects"]')).toBe('pointer');
	expect(await cursorOf('a[href*="/projects/"]')).toBe('pointer');
	// Disabled stays inert.
	const zoomOut = page.getByTestId('zoom-controls').getByRole('button', { name: 'Zoom out' });
	for (let i = 0; i < 5; i++) await zoomOut.click();
	expect(await zoomOut.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
});

test('@smoke an icon button paints no background, and colours on hover', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');

	const sort = page.getByRole('button', { name: 'Sort and expand projects' });
	const styles = () =>
		sort.evaluate((el) => {
			const s = getComputedStyle(el);
			return { background: s.backgroundColor, color: s.color };
		});

	const atRest = await styles();
	// Transparent, not merely "the same colour as the panel" — a ghost button
	// would report an opaque accent here once hovered.
	expect(atRest.background).toBe('rgba(0, 0, 0, 0)');

	await sort.hover();
	// toHaveCSS rather than a single read: the sidebar re-renders on its 2s
	// projects poll, so a one-shot getComputedStyle can land on the frame before
	// the repaint and read the resting colour.
	await expect(sort).not.toHaveCSS('color', atRest.color);
	await expect(sort).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('@smoke a chevron takes colour when its row is hovered', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');

	const chevron = page.getByRole('button', { name: 'Expand zulu' });
	const colour = () => chevron.evaluate((el) => getComputedStyle(el).color);

	const atRest = await colour();
	await chevron.hover();
	await expect(chevron).not.toHaveCSS('color', atRest);
});

test('@smoke menu items get a pointer too', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');

	await page.getByRole('button', { name: 'Sort and expand projects' }).click();

	// The vendored shadcn primitives ship `cursor-default` on menu rows, which
	// beat the base rule until it was removed — a class on the element always
	// wins over a bare-selector rule.
	const item = page.getByRole('menuitem', { name: 'Expand all' });
	const radio = page.getByRole('menuitemradio', { name: 'Recent' });
	await expect(item).toHaveCSS('cursor', 'pointer');
	await expect(radio).toHaveCSS('cursor', 'pointer');
});
