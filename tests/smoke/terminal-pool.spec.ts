import { expect, test } from '@playwright/test';
import { fixtureTwoProjectsManySessions, installMockBridge } from './fixtures';

/**
 * The pooled terminal's DOM contract (F5).
 *
 * **A pooled host never leaves the document once it has been shown.** That is
 * the fix for the macOS report of 2026-08-28 — the wheel doing nothing over a
 * session you had just switched to, until you clicked into it — and the symptom
 * itself cannot be reproduced here: it needs WebKit's scrolling thread and the
 * wheel event region it hit-tests against, neither of which Chromium or
 * WebKitGTK has. What the browser lane can hold onto is the cause, which is
 * plain DOM: the host used to be removed from the pane on unmount and appended
 * back on mount, and the region is built from nodes whose handlers were
 * registered while connected.
 *
 * So this counts disconnections rather than asserting on scrolling. It fails
 * the moment someone reintroduces the reparent.
 */
test('@smoke switching session never takes a terminal out of the document', async ({ page }) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand zulu' }).click();
	await page.getByRole('link', { name: /Zulu task 11/ }).click();
	await expect(page.locator('.xterm:visible')).toBeVisible();

	// Watch the first session's host from the outside: a MutationObserver on the
	// whole body sees the removal whichever parent it happens under.
	await page.evaluate(() => {
		const host = document.querySelector('.xterm')?.parentElement as HTMLElement;
		const probe = { host, disconnects: 0 };
		(window as unknown as { __POOL__: typeof probe }).__POOL__ = probe;
		new MutationObserver(() => {
			if (!document.contains(probe.host)) probe.disconnects++;
		}).observe(document.body, { childList: true, subtree: true });
	});

	await page.getByRole('link', { name: /Zulu task 10/ }).click();
	await expect(page.getByRole('tab', { name: /Zulu task 10/ })).toHaveAttribute(
		'aria-selected',
		'true',
	);
	await page.getByRole('tab', { name: /Zulu task 11/ }).click();
	await expect(page.getByRole('tab', { name: /Zulu task 11/ })).toHaveAttribute(
		'aria-selected',
		'true',
	);

	const probe = await page.evaluate(() => {
		const p = (window as unknown as { __POOL__: { host: HTMLElement; disconnects: number } })
			.__POOL__;
		return { disconnects: p.disconnects, connected: document.contains(p.host) };
	});
	expect(probe).toEqual({ disconnects: 0, connected: true });

	// Both terminals are in the pane, and exactly one of them is on screen —
	// hidden, not detached, is the whole of the mechanism.
	await expect(page.locator('.xterm')).toHaveCount(2);
	await expect(page.locator('.xterm:visible')).toHaveCount(1);
});

/**
 * And a pooled host that is not the visible one is moved out of the viewport
 * (PERF-04).
 *
 * xterm pauses its renderer from an `IntersectionObserver` on its screen
 * element, and `visibility: hidden` does not change where an element is — so
 * every background terminal kept rewriting its rows as its output arrived, for
 * as many sessions as had ever been opened. A translation takes it out of the
 * viewport without touching its layout box, which is what the pool needs it to
 * keep.
 *
 * Leftwards, and the assertion says so: overflow past the left edge is clipped,
 * overflow past the right is scrollable and would give the pane a horizontal
 * scrollbar for a terminal nobody can see.
 */
test('@smoke the terminal that is not showing is off screen, and keeps its box', async ({
	page,
}) => {
	await installMockBridge(page, fixtureTwoProjectsManySessions());
	await page.goto('/');
	await page.getByRole('button', { name: 'Expand zulu' }).click();
	await page.getByRole('link', { name: /Zulu task 11/ }).click();
	await expect(page.locator('.xterm:visible')).toBeVisible();
	await page.getByRole('link', { name: /Zulu task 10/ }).click();
	await expect(page.locator('.xterm')).toHaveCount(2);

	const state = await page.evaluate(() => {
		const hosts = Array.from(document.querySelectorAll('.xterm')).map(
			(el) => el.parentElement as HTMLElement,
		);
		return hosts.map((h) => {
			const r = h.getBoundingClientRect();
			return {
				hidden: h.style.visibility === 'hidden',
				offLeft: r.right <= 0,
				width: Math.round(r.width),
				height: Math.round(r.height),
				clientWidth: h.clientWidth,
			};
		});
	});

	const shown = state.filter((s) => !s.hidden);
	const parked = state.filter((s) => s.hidden);
	expect(shown).toHaveLength(1);
	expect(parked).toHaveLength(1);
	expect(shown[0].offLeft).toBe(false);
	expect(parked[0].offLeft).toBe(true);

	// The box it keeps is the pane's, which is what `fitToHost` measures and why
	// a background terminal is already the right size when you switch to it.
	expect(parked[0].width).toBe(shown[0].width);
	expect(parked[0].height).toBe(shown[0].height);
	expect(parked[0].clientWidth).toBe(shown[0].clientWidth);

	// And switching back moves it into the viewport rather than rebuilding it.
	await page.getByRole('tab', { name: /Zulu task 11/ }).click();
	await expect(page.locator('.xterm:visible')).toHaveCount(1);
	const swapped = await page.evaluate(() =>
		Array.from(document.querySelectorAll('.xterm'))
			.map((el) => el.parentElement as HTMLElement)
			.map((h) => ({
				hidden: h.style.visibility === 'hidden',
				offLeft: h.getBoundingClientRect().right <= 0,
			})),
	);
	expect(swapped.filter((s) => s.offLeft)).toHaveLength(1);
	expect(swapped.every((s) => s.hidden === s.offLeft)).toBe(true);
});
