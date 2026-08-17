import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Window-level error handling (specs/05-features.md F17, "The window-level
 * half").
 *
 * The bug these guard: `main.tsx` carried an M0 scaffold that set
 * `root.innerHTML` on **any** unhandled rejection, which unmounts the React
 * tree and every live xterm in it. Monaco rejects with a `CancellationError`
 * every time a diff editor is disposed with a worker diff in flight — normal,
 * and something Monaco's own handler ignores — so clicking through commits in
 * the Graph tab blanked the app.
 *
 * These dispatch the events directly rather than trying to provoke Monaco,
 * because the contract under test is the *classification*, not Monaco's
 * timing. Provoking it needs a race; asserting it needs determinism.
 */

/** Exactly what `new CancellationError()` produces: name and message both set
 *  to `Canceled`. Built in the page so it is a real `Error` there. */
async function rejectWithCancellation(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const err = new Error('Canceled');
		err.name = 'Canceled';
		const p = Promise.reject(err);
		p.catch(() => {}); // keep the browser's own handler quiet
		window.dispatchEvent(
			new PromiseRejectionEvent('unhandledrejection', { promise: p, reason: err }),
		);
	});
}

test.describe('window-level errors', () => {
	test('@smoke a cancelled Monaco request neither blanks the app nor shows anything', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await expect(page.locator('aside').getByText('foo')).toBeVisible();

		await rejectWithCancellation(page);

		// The app is still there — this is the assertion the old handler failed.
		await expect(page.locator('aside').getByText('foo')).toBeVisible();
		// And nothing was reported, because it is not an error.
		await expect(page.locator('#factorai-error-notice')).toHaveCount(0);
	});

	test('@smoke a real rejection is reported without destroying the app', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await expect(page.locator('aside').getByText('foo')).toBeVisible();

		await page.evaluate(() => {
			const err = new TypeError('something actually broke');
			const p = Promise.reject(err);
			p.catch(() => {});
			window.dispatchEvent(
				new PromiseRejectionEvent('unhandledrejection', { promise: p, reason: err }),
			);
		});

		const notice = page.locator('#factorai-error-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toContainText('something actually broke');
		// The whole point: reported *and* still usable.
		await expect(page.locator('aside').getByText('foo')).toBeVisible();

		// Dismissible, and dismissing takes the host with it.
		await notice.getByRole('button', { name: 'Dismiss' }).click();
		await expect(page.locator('#factorai-error-notice')).toHaveCount(0);
	});

	test('@smoke repeats coalesce into a count rather than stacking', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		await expect(page.locator('aside').getByText('foo')).toBeVisible();

		await page.evaluate(() => {
			for (let i = 0; i < 3; i++) {
				const err = new TypeError('same failure every time');
				const p = Promise.reject(err);
				p.catch(() => {});
				window.dispatchEvent(
					new PromiseRejectionEvent('unhandledrejection', { promise: p, reason: err }),
				);
			}
		});

		const notice = page.locator('#factorai-error-notice');
		// One card, not three — twenty identical cards is worse than a count.
		await expect(notice.locator('[data-notice]')).toHaveCount(1);
		await expect(notice).toContainText('×3');
	});
});
