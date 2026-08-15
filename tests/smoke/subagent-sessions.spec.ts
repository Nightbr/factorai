import { expect, test } from '@playwright/test';
import { fixtureWithSubagents, installMockBridge } from './fixtures';

/**
 * Sub-agent sessions (specs/05-features.md F2/F3): listed nested under their
 * parent and marked, never resumable — opening one shows a read-only
 * transcript instead of a terminal.
 */
test.describe('sub-agent sessions', () => {
	test('@smoke nest under their parent with a badge', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		await page.goto(`/#/projects/${projectId}`);

		const rows = page.locator('main ul > li');
		await expect(rows).toHaveCount(3);

		// The parent leads, agents follow — and each agent carries the badge
		// and the read-only affordance instead of the chevron.
		await expect(rows.nth(1)).toContainText('sub-agent');
		await expect(rows.nth(1)).toContainText('read-only');
		await expect(rows.nth(2)).toContainText('sub-agent');
		// The parent row has neither: it opens a terminal.
		await expect(rows.nth(0)).not.toContainText('read-only');
	});

	test('@smoke open read-only with a transcript, no terminal', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		const agentId = 'agent-1111';
		await page.goto(`/#/projects/${projectId}/sessions/${agentId}`);

		// The header says what this is and offers no process controls.
		await expect(page.getByText('sub-agent', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0);

		// The transcript body renders from get_session_tail's fixture page.
		await expect(page.getByTestId('subagent-transcript')).toContainText(
			'Explore the repo, search breadth medium',
		);
	});
});
