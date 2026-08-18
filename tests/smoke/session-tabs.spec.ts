import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ZULU_ID, fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * Header tabs for live sessions (specs/05-features.md F16).
 *
 * A tab is a running PTY, so these open sessions to create tabs rather than
 * injecting them: the strip has no state of its own beyond the drag order.
 */
async function openSession(page: Page, name: RegExp) {
	await page.getByRole('link', { name }).click();
	await expect(page.locator('.xterm')).toBeVisible();
}

/** Drag one tab onto another with the pointer, which is what dnd-kit listens to
 *  (ADR-0016). The steps matter: the sensor only starts a drag once the pointer
 *  has travelled 4px, so a single jump to the target would land as a click. */
async function dragTab(page: Page, source: RegExp, target: RegExp) {
	const from = await page.getByRole('tab', { name: source }).boundingBox();
	const to = await page.getByRole('tab', { name: target }).boundingBox();
	if (!from || !to) throw new Error('tabs not laid out');
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
	await page.mouse.up();
}

test.describe('session tabs', () => {
	test('@smoke the strip is absent until a session is live', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		await expect(page.getByTestId('session-tabs')).toHaveCount(0);

		// …and with no tabs the panel toggle still sits at the right end of the
		// bar. It slid over to the app name when the strip returned null, because
		// it was the only flexible thing in that row.
		const bar = await page.locator('header').first().boundingBox();
		const toggle = await page.getByRole('button', { name: 'Toggle file tree' }).boundingBox();
		const gapToRight =
			(bar?.x ?? 0) + (bar?.width ?? 0) - ((toggle?.x ?? 0) + (toggle?.width ?? 0));
		expect(gapToRight).toBeLessThan(24);

		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await expect(page.getByTestId('session-tabs').getByRole('tab')).toHaveCount(1);
	});

	test('@smoke one tab per live session, and the current one is selected', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);

		const tabs = page.getByTestId('session-tabs').getByRole('tab');
		await expect(tabs).toHaveCount(2);
		// The one just opened is selected; the other is not.
		await expect(tabs.filter({ hasText: 'Zulu task 10' })).toHaveAttribute('aria-selected', 'true');
		await expect(tabs.filter({ hasText: 'Zulu task 11' })).toHaveAttribute(
			'aria-selected',
			'false',
		);
	});

	test('@smoke clicking a tab switches session', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);

		await page.getByRole('tab', { name: /Zulu task 11/ }).click();

		await expect(page).toHaveURL(/sessions\/zulu-session-11$/);
		await expect(page.getByRole('tab', { name: /Zulu task 11/ })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});

	test('@smoke closing asks first, and kills the PTY on confirm', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: /Close Zulu task 11/ }).click();

		// Nothing happens until you say so — closing a tab kills a Claude session.
		await expect(page.getByText('Close this session?')).toBeVisible();
		let calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);

		await page.getByRole('button', { name: /Close & kill session/ }).click();

		calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(true);
		// Tab gone, and you land back on the project rather than a dead pane.
		await expect(page.getByTestId('session-tabs')).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`projects/${ZULU_ID}$`));
	});

	test('@smoke keeping it running closes the dialog and changes nothing', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('button', { name: /Close Zulu task 11/ }).click();
		await page.getByRole('button', { name: /Keep it running/ }).click();

		await expect(page.getByText('Close this session?')).toHaveCount(0);
		await expect(page.getByTestId('session-tabs').getByRole('tab')).toHaveCount(1);
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);
	});

	test('@smoke middle-clicking a tab asks before closing it', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		await page.getByRole('tab', { name: /Zulu task 11/ }).click({ button: 'middle' });

		// The shortcut reaches the same guard as the × — closing kills a live
		// Claude session, and a stray middle-click must not be able to do that.
		await expect(page.getByText('Close this session?')).toBeVisible();
		const calls = await page.evaluate(() => window.__FACTORAI_TEST_CALLS__ ?? []);
		expect(calls.some((c) => c.name === 'terminal_kill')).toBe(false);

		await page.getByRole('button', { name: /Close & kill session/ }).click();
		await expect(page.getByTestId('session-tabs')).toHaveCount(0);
	});

	test('@smoke tabs can be dragged into a different order', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);
		await openSession(page, /Zulu task 9/);

		// By session id, not by text: a tab renders the project avatar's initials
		// as text too, so `allTextContents` gives "ZUZulu task 11".
		const order = () =>
			page
				.getByTestId('session-tabs')
				.getByRole('tab')
				.evaluateAll((tabs) => tabs.map((t) => t.getAttribute('data-session-id')));
		expect(await order()).toEqual(['zulu-session-11', 'zulu-session-10', 'zulu-session-09']);

		// **A real pointer drag, not `dragTo`.** Since 2026-08-18 this is dnd-kit
		// rather than native HTML5 drag-and-drop, because the OS drag session is
		// unusable inside Tauri's window on macOS (ADR-0016). `dragTo` dispatches
		// `dragstart` / `drop`, which nothing listens for now — the sensor is
		// pointer events, so the test drives pointer events.
		await dragTab(page, /Zulu task 9/, /Zulu task 11/);

		expect(await order()).toEqual(['zulu-session-09', 'zulu-session-11', 'zulu-session-10']);
	});

	test('@smoke a dragged tab moves into place before it is dropped', async ({ page }) => {
		const fx = fixtureTwoProjectsManySessions();
		// **A title long enough to hit the 240px cap**, so the two tabs in this drag
		// are visibly different widths. That is what makes the "no distortion"
		// assertion below mean something: dnd-kit scales the dragged item by the
		// ratio of the tab it is over to itself, and with equal widths the ratio is
		// 1 and a regression is invisible.
		const wide = fx.sessionsByProject?.[ZULU_ID]?.find((s) => s.id === 'zulu-session-11');
		if (wide) wide.title = 'Zulu task 11, with a title long enough to fill a whole tab';
		await installMockBridge(page, fx);
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);
		await openSession(page, /Zulu task 9/);

		const first = page.getByRole('tab', { name: /Zulu task 11/ });
		const source = page.getByRole('tab', { name: /Zulu task 9/ });
		const before = await first.boundingBox();
		const from = await source.boundingBox();
		if (!before || !from) throw new Error('tabs not laid out');
		// The premise of the test: the tabs really are different widths.
		expect(before.width).toBeGreaterThan(from.width + 40);

		// Hand-driven and left holding, because the point is the state *mid*
		// gesture: the strip shows the arrangement you would get instead of making
		// you drop to find out.
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 10 });

		// **The preview is a transform, not a reordered list** — that is the one
		// behavioural difference dnd-kit brings: the DOM order changes on drop, and
		// until then the other tabs slide out of the way. So this asserts the slide:
		// the tab we are dragging onto has moved right to open the gap.
		await expect
			.poll(async () => (await first.boundingBox())?.x ?? 0)
			.toBeGreaterThan(before.x + 20);

		// **And the tab in flight is still its own size.** dnd-kit publishes the
		// active transform through `adjustScale(translate, over.rect,
		// activeNodeRect)`, so `CSS.Transform.toString` scales the tab you are
		// holding to the width of the tab you are over — reported as a tab that
		// zooms mid-drag. `CSS.Translate.toString` is the whole fix, and this is the
		// assertion that would have caught it: a bounding box reflects the scale.
		const mid = await source.boundingBox();
		expect(Math.abs((mid?.width ?? 0) - from.width)).toBeLessThan(1);

		await page.mouse.up();

		const order = await page
			.getByTestId('session-tabs')
			.getByRole('tab')
			.evaluateAll((tabs) => tabs.map((t) => t.getAttribute('data-session-id')));
		expect(order).toEqual(['zulu-session-09', 'zulu-session-11', 'zulu-session-10']);
		// And the transform is gone once the list itself holds the order — a tab
		// left translated would sit on top of its neighbour.
		await expect(first).toHaveJSProperty('style.transform', '');
	});

	test('@smoke Alt+arrows move the focused tab without a mouse', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);
		await openSession(page, /Zulu task 10/);
		await openSession(page, /Zulu task 9/);

		const order = () =>
			page
				.getByTestId('session-tabs')
				.getByRole('tab')
				.evaluateAll((tabs) => tabs.map((t) => t.getAttribute('data-session-id')));

		// A drag-only reorder is unreachable without a mouse, and dnd-kit's own
		// keyboard sensor wants the space bar — which on a `role="tab"` already
		// means "activate this tab". Alt+arrows need no mode at all.
		const last = page.getByRole('tab', { name: /Zulu task 9/ });
		await last.focus();
		await page.keyboard.press('Alt+ArrowLeft');
		expect(await order()).toEqual(['zulu-session-11', 'zulu-session-09', 'zulu-session-10']);

		// Focus travels with the tab, so a second press keeps moving the same one
		// rather than whatever landed under it.
		await page.keyboard.press('Alt+ArrowLeft');
		expect(await order()).toEqual(['zulu-session-09', 'zulu-session-11', 'zulu-session-10']);

		// And it stops at the end of the strip instead of wrapping around.
		await page.keyboard.press('Alt+ArrowLeft');
		expect(await order()).toEqual(['zulu-session-09', 'zulu-session-11', 'zulu-session-10']);
	});

	test('@smoke the strip spans the bar rather than half of it', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand zulu' }).click();
		await openSession(page, /Zulu task 11/);

		const bar = await page.locator('header').first().boundingBox();
		const strip = await page.getByTestId('session-tabs').boundingBox();
		// Brand on the left and the panel toggle on the right take ~200px between
		// them; a second flex-1 sibling used to take half of what was left.
		expect((strip?.width ?? 0) / (bar?.width ?? 1)).toBeGreaterThan(0.7);
	});

	test('@smoke the panel toggle stays right-aligned with no tabs open', async ({ page }) => {
		await installMockBridge(page, fixtureTwoProjectsManySessions());
		await page.goto('/');

		// Regression: the strip renders nothing when no session is live, and with
		// no spacer left in the bar the toggle slid up against the wordmark.
		await expect(page.getByTestId('session-tabs')).toHaveCount(0);

		const bar = await page.locator('header').first().boundingBox();
		const toggle = await page.getByRole('button', { name: 'Toggle file tree' }).boundingBox();
		const rightEdgeGap =
			(bar?.x ?? 0) + (bar?.width ?? 0) - ((toggle?.x ?? 0) + (toggle?.width ?? 0));
		expect(rightEdgeGap).toBeLessThan(24);
	});
});
