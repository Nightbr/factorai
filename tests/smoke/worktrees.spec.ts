import { expect, test } from '@playwright/test';
import { FOO_ID, fixtureSessionInAWorktree, installMockBridge } from './fixtures';

const IN_WORKTREE = `/#/projects/${FOO_ID}/sessions/session-uuid-002`;
const IN_PROJECT = `/#/projects/${FOO_ID}/sessions/session-uuid-001`;

async function openPanel(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await expect(page.getByTestId('file-tree-panel')).toBeVisible();
}

/**
 * The panel follows the checkout the session is working in (F21).
 *
 * These drive the *resolution*, not the signal: the mock bridge has no IDE
 * socket, so what is exercised is the persisted `worktree` column and the
 * `cwd` fallback — which is exactly the half that has to work when the agent
 * never calls the tool.
 */
test.describe('worktrees', () => {
	test('@smoke the panel roots on the session’s worktree, not the project folder', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		// The tree's root row is the checkout, so the file only that checkout holds
		// is the proof it re-rooted.
		await expect(page.getByText('switcher.ts')).toBeVisible();
	});

	test('@smoke the header names the worktree beside the branch', async ({ page }) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);

		const badge = page.getByTestId('session-worktree');
		await expect(badge).toBeVisible();
		await expect(badge).toContainText('feature-x');
		// **Two facts that agree about where you are.** The branch badge names the
		// *checkout's* branch, not the project's — it said `main` beside a worktree
		// on another branch for one commit, which made the pair contradict.
		await expect(page.getByTestId('session-branch')).toContainText('feature-x');
	});

	test('@smoke the header and the panel call the checkout the same thing', async ({ page }) => {
		// They disagreed for one commit — `wt-demo` in the header, `demo/worktree`
		// in the panel — which reads as two different places.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		const header = await page.getByTestId('session-worktree').innerText();
		const panel = await page.getByTestId('panel-checkout').innerText();
		expect(panel.trim()).toBe(header.trim());
	});

	test('@smoke a session in the project’s own checkout gets no worktree furniture', async ({
		page,
	}) => {
		// The 95% case, and the one that must look exactly as it did before F21.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_PROJECT);
		await openPanel(page);

		await expect(page.getByTestId('session-worktree')).toHaveCount(0);
		await expect(page.getByTestId('panel-checkout')).toHaveCount(0);
	});

	test('@smoke the tree names the checkout beside its root folder', async ({ page }) => {
		// On the root row, not in the tab strip — that row already holds three tabs
		// and two icons at 288px. Changed 2026-08-21 on user feedback.
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);
		await openPanel(page);

		const mark = page.getByTestId('panel-checkout');
		await expect(mark).toContainText('feature-x');
		// On a tree row, not in the tab strip — asserted both ways round, because
		// "it is visible somewhere in the panel" is what the old placement also
		// satisfied.
		await expect(page.locator('li').filter({ has: mark })).toHaveCount(1);
		await expect(page.getByRole('tablist').getByTestId('panel-checkout')).toHaveCount(0);
	});

	test('@smoke the sidebar marks the session that ran in another checkout', async ({ page }) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto('/');
		await page.getByRole('button', { name: 'Expand foo' }).click();

		// One mark, on the rolled-up row only — the other session ran in the
		// project folder and needs no explaining.
		const marks = page.getByTestId('sidebar-session-checkout');
		await expect(marks).toHaveCount(1);
		await expect(marks.first()).toHaveText('feature-x');
	});

	test('@smoke the revert returns the panel to the session’s own checkout', async ({ page }) => {
		await installMockBridge(page, fixtureSessionInAWorktree());
		await page.goto(IN_WORKTREE);

		await page.getByRole('button', { name: "Back to this session's own checkout" }).click();

		// The record is cleared through the backend, not only in the renderer —
		// otherwise the stored row wins again on the next read.
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as unknown as { __FACTORAI_TEST_CALLS__?: { name: string }[] }
						).__FACTORAI_TEST_CALLS__?.map((c) => c.name) ?? [],
				),
			)
			.toContain('clear_session_worktree');
	});
});
