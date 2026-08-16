import { expect, test } from '@playwright/test';
import { fixtureWithSubagents, installMockBridge } from './fixtures';

/**
 * Sub-agent sessions (specs/05-features.md F2/F3): folded under the session
 * that spawned them and marked, never resumable — opening one shows a
 * read-only transcript instead of a terminal.
 */
test.describe('sub-agent sessions', () => {
	test('@smoke stay collapsed under their parent until asked for', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		await page.goto(`/#/projects/${projectId}`);

		// One row, not three: a session that spawned six agents used to put seven
		// rows in this list and bury the project's real sessions.
		const groups = page.locator('main > div > ul > li');
		await expect(groups).toHaveCount(1);
		await expect(page.getByText('Explore the sidebar component')).toHaveCount(0);

		// The count badge is the only thing that says they are there, so it has
		// to carry the number rather than decorate the toggle.
		await expect(page.getByTestId('agent-count')).toHaveText('2');
	});

	test('@smoke the toggle reveals them, marked and read-only', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		const parentId = fx.sessionsByProject?.[projectId]?.[0]?.id ?? '';
		await page.goto(`/#/projects/${projectId}`);

		const toggle = page.getByRole('button', { name: /Show sub-agents of/ });
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();

		const nested = page.getByTestId(`subagents-of-${parentId}`).locator('li');
		await expect(nested).toHaveCount(2);
		await expect(nested.nth(0)).toContainText('Explore the sidebar component');
		// Each agent carries the badge and the read-only affordance instead of
		// the chevron that everywhere else means "a terminal opens".
		await expect(nested.nth(0)).toContainText('sub-agent');
		await expect(nested.nth(0)).toContainText('read-only');
		await expect(nested.nth(1)).toContainText('sub-agent');

		// And it closes again.
		await page.getByRole('button', { name: /Hide sub-agents of/ }).click();
		await expect(page.getByTestId(`subagents-of-${parentId}`)).toHaveCount(0);
	});

	test('@smoke the badges line up in one column', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		await page.goto(`/#/projects/${projectId}`);
		await page.getByRole('button', { name: /Show sub-agents of/ }).click();

		// The badge used to sit inline after the title, so a truncating title put
		// it at a different x on every row. Right-aligned, they share a column —
		// which is the whole of "aligned properly".
		const badges = page.getByTestId('subagent-badge');
		await expect(badges).toHaveCount(2);
		const rights = await badges.evaluateAll((els) =>
			els.map((el) => Math.round(el.getBoundingClientRect().right)),
		);
		expect(rights[0]).toBe(rights[1]);
	});

	test('@smoke a parent with no agents gets no toggle', async ({ page }) => {
		const fx = fixtureWithSubagents();
		const projectId = fx.projects?.[0]?.id ?? '';
		// Drop the agents: the same session, alone.
		const parent = fx.sessionsByProject?.[projectId]?.[0];
		if (!parent) throw new Error('fixture has no parent session');
		await installMockBridge(page, { ...fx, sessionsByProject: { [projectId]: [parent] } });
		await page.goto(`/#/projects/${projectId}`);

		await expect(page.getByRole('button', { name: /sub-agents of/ })).toHaveCount(0);
		await expect(page.getByTestId('agent-count')).toHaveCount(0);
	});

	test('@smoke open read-only with a transcript, no terminal', async ({ page }) => {
		const fx = fixtureWithSubagents();
		await installMockBridge(page, fx);
		const projectId = fx.projects?.[0]?.id ?? '';
		const agentId = 'agent-1111';
		await page.goto(`/#/projects/${projectId}/sessions/${agentId}`);

		// The header says what this is and offers no process controls.
		await expect(page.getByText('sub-agent', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Close session' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Restart' })).toHaveCount(0);

		// The transcript body renders from get_session_tail's fixture page.
		await expect(page.getByTestId('subagent-transcript')).toContainText(
			'Explore the repo, search breadth medium',
		);
	});
});
