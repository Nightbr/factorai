import { expect, test } from '@playwright/test';
import { fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The settings modal (specs/05-features.md F11).
 *
 * **Two tests, deliberately.** The suite is already at 130-odd and E1 says
 * everything else goes to the future regression lane: what is here is the way
 * in (the gear, and a deep link) and the thing an explicit Save makes
 * load-bearing (Save persists, Cancel discards). The dirty-diffing itself is
 * unit-tested in `settingsDraft.test.ts`, where it belongs.
 */
test.describe('settings', () => {
	test('@smoke the gear opens it and ?settings= deep-links a section', async ({ page }) => {
		await installMockBridge(page, {
			...fixtureOneProjectOneSession(),
			claudeCli: { installed: true, binaryPath: '/opt/homebrew/bin/claude', version: '0.2.34' },
		});
		await page.goto('/');

		await expect(page.getByTestId('settings-modal')).toHaveCount(0);
		await page.getByTestId('open-settings').click();

		const modal = page.getByTestId('settings-modal');
		await expect(modal).toBeVisible();
		// Opens on Agents, whose Claude card is collapsed to its badge and version
		// and, expanded, reports the detected binary (F11, F30).
		await expect(modal.getByTestId('settings-agent-claude-badge')).toHaveText(/active/i);
		await modal.getByTestId('settings-agent-claude-toggle').click();
		await expect(modal.getByText('/opt/homebrew/bin/claude')).toBeVisible();
		// The state is in the URL, which is what gives deep links and back-closes.
		await expect(page).toHaveURL(/[?&]settings=agents/);

		// Esc dismisses, silently — it is a deliberate gesture that already means
		// "back out".
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('settings-modal')).toHaveCount(0);
		await expect(page).not.toHaveURL(/settings=/);

		// And a hand-written URL opens the section it names, on reload as well as
		// on navigation — the whole reason the param exists.
		await page.goto('/?settings=editor');
		await expect(page.getByTestId('settings-modal')).toBeVisible();
		await expect(page.getByTestId('settings-diff-inline')).toBeVisible();
		await expect(page.getByTestId('settings-frontmatter-open')).toBeVisible();
		await expect(page.getByTestId('settings-nav-editor')).toHaveAttribute('aria-current', 'page');

		// A section nobody has built is not a section: the param is validated on
		// the root route exactly as `?file=`'s diff mode is. `appearance` was the
		// example until 2026-08-29 and `advanced` until 2026-09-23, when each got
		// its content.
		await page.goto('/?settings=network');
		await expect(page.getByTestId('settings-modal')).toHaveCount(0);
	});

	test('@smoke the update channel saves under Advanced and About names it', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		// Unset is stable (ADR-0064), and About says so before anything is chosen.
		await page.goto('/?settings=about');
		await expect(page.getByTestId('settings-about-channel')).toHaveText('Stable');

		await page.getByTestId('settings-nav-advanced').click();
		const channel = page.getByTestId('settings-update-channel');
		await expect(channel).toHaveText(/Stable/);
		await channel.click();
		await page.getByTestId('settings-update-channel-alpha').click();
		await expect(page.getByTestId('settings-dirty-advanced')).toBeVisible();
		await page.getByTestId('settings-save').click();
		await expect(page.getByTestId('settings-modal')).toHaveCount(0);

		// Reopened in place rather than by URL: a navigation reloads the mock
		// bridge's fixture, and the setting was written into this page's copy.
		await page.getByTestId('open-settings').click();
		await page.getByTestId('settings-nav-about').click();
		await expect(page.getByTestId('settings-about-channel')).toHaveText('Alpha');
	});

	test('@smoke the confirmations copy says when each one asks', async ({ page }) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/?settings=confirmations');
		// `needsQuitConfirm` asks only while an agent is working (ADR-0020), so the
		// note must not promise it always does.
		const note = page.getByTestId('settings-quit-note');
		await expect(note).toContainText('whenever an agent is working');
		await expect(note).not.toContainText('always');
		// And the close switch names no one agent: Codex sessions ask too (F30).
		await expect(page.getByText('Only while its agent is working')).toBeVisible();
		await expect(page.getByTestId('settings-modal')).not.toContainText('Claude is working');
	});

	test('@smoke Save persists and Cancel discards', async ({ page }) => {
		await installMockBridge(page, {
			...fixtureOneProjectOneSession(),
			claudeCli: { installed: true, binaryPath: '/opt/homebrew/bin/claude', version: '0.2.34' },
		});
		await page.goto('/?settings=confirmations');

		const save = page.getByTestId('settings-save');
		// Save *is* the unsaved-changes indicator, so it starts disabled.
		await expect(save).toBeDisabled();

		const confirmClose = page.getByTestId('settings-confirm-close');
		await expect(confirmClose).toHaveAttribute('aria-checked', 'true');
		await confirmClose.click();

		// A dot says *which* section holds the edit — with one Save button and four
		// sections, "something is unsaved" without "where" makes you hunt.
		await expect(page.getByTestId('settings-dirty-confirmations')).toBeVisible();
		await expect(save).toBeEnabled();

		// Cancel discards in silence, and reopening shows the stored value.
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByTestId('settings-modal')).toHaveCount(0);
		await page.goto('/?settings=confirmations');
		await expect(page.getByTestId('settings-confirm-close')).toHaveAttribute(
			'aria-checked',
			'true',
		);

		// Now the same edit, saved.
		await page.getByTestId('settings-confirm-close').click();
		await page.getByTestId('settings-save').click();
		await expect(page.getByTestId('settings-modal')).toHaveCount(0);

		// Persisted, so it survives a full reload rather than living in React
		// state — `prefsStore` is on localStorage for exactly this.
		await page.reload();
		await page.goto('/?settings=confirmations');
		await expect(page.getByTestId('settings-confirm-close')).toHaveAttribute(
			'aria-checked',
			'false',
		);
		// …and the switch it does not share a row with is untouched.
		await expect(page.getByTestId('settings-confirm-middle-click')).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});
});
