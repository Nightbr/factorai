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
