import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * Zoom controls in the sidebar footer (specs/05-features.md F15).
 *
 * The webview call itself is a Tauri API and inert here; what's testable in the
 * browser is the control's state machine and that it persists.
 */
test.describe('zoom controls', () => {
	test('@smoke steps up and down, and resets by clicking the readout', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');

		const zoom = page.getByTestId('zoom-controls');
		await expect(zoom).toContainText('100%');

		await zoom.getByRole('button', { name: 'Zoom in' }).click();
		await expect(zoom).toContainText('110%');
		await zoom.getByRole('button', { name: 'Zoom out' }).click();
		await zoom.getByRole('button', { name: 'Zoom out' }).click();
		// 90%, not 90.00000000000001% — the rounding in clampZoom.
		await expect(zoom).toContainText('90%');

		await zoom.getByRole('button', { name: 'Reset zoom' }).click();
		await expect(zoom).toContainText('100%');
	});

	test('@smoke disables each control at its limit', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		const zoom = page.getByTestId('zoom-controls');
		const zoomIn = zoom.getByRole('button', { name: 'Zoom in' });
		const zoomOut = zoom.getByRole('button', { name: 'Zoom out' });

		// Ten steps of 0.1 from 100% reaches the 200% ceiling exactly. The button
		// disabling there IS the clamp, as far as the UI is concerned — clicking
		// past it isn't possible, which is the point.
		for (let i = 0; i < 10; i++) await zoomIn.click();
		await expect(zoom).toContainText('200%');
		await expect(zoomIn).toBeDisabled();
		await expect(zoomOut).toBeEnabled();

		await zoom.getByRole('button', { name: 'Reset zoom' }).click();
		await expect(zoomIn).toBeEnabled();

		// And five steps down reaches the 50% floor.
		for (let i = 0; i < 5; i++) await zoomOut.click();
		await expect(zoom).toContainText('50%');
		await expect(zoomOut).toBeDisabled();
	});

	test('@smoke keeps the level across a reload', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/');
		const zoom = page.getByTestId('zoom-controls');

		await zoom.getByRole('button', { name: 'Zoom in' }).click();
		await zoom.getByRole('button', { name: 'Zoom in' }).click();
		await expect(zoom).toContainText('120%');

		await page.reload();
		await expect(page.getByTestId('zoom-controls')).toContainText('120%');
	});
});
