import { expect, test } from '@playwright/test';
import { installMockBridge, type TestFixture } from '../smoke/fixtures';
import { around, shot } from './capture';
import { HOME, world } from './world';

const HOUR = 3_600_000;

type ImportCandidate = NonNullable<TestFixture['importCandidates']>[number];

/** What a fresh install sees: agents detected, nothing added yet. */
function freshInstall() {
	const { claudeCli, codexCli } = world();
	return { claudeCli, codexCli, projects: [] };
}

function candidate(
	name: string,
	sessionCount: number,
	agoHours: number,
	extra: Partial<ImportCandidate> = {},
): ImportCandidate {
	const realPath = `${HOME}/${name}`;
	return {
		agent: 'claude',
		key: `-${realPath.replace(/^\/+/, '').replace(/\//g, '-')}`,
		realPath,
		displayName: name,
		sessionCount,
		lastActivityAt: Date.now() - agoHours * HOUR,
		missing: false,
		alreadyOpen: false,
		...extra,
	};
}

test('first-run: the empty sidebar', async ({ page }) => {
	await installMockBridge(page, freshInstall());
	await page.goto('/');
	const sidebar = page.getByTestId('sidebar');
	await expect(sidebar).toContainText('No projects yet');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	// The top of the sidebar only: below the two buttons it is empty to the
	// footer, and the picture is about what the empty state offers.
	const top = await around([sidebar], 0);
	const importButton = await sidebar.getByText('Import from Claude Code…').boundingBox();
	if (!importButton) throw new Error('no import button');
	await shot(page, 'first-run-empty', {
		...top,
		height: importButton.y + importButton.height + 28 - top.y,
	});
});

test('first-run: the Import from Claude Code dialog', async ({ page }) => {
	await installMockBridge(page, {
		...freshInstall(),
		importCandidates: [
			candidate('billing-api', 23, 1),
			candidate('docs-site', 9, 5),
			candidate('homelab', 14, 50),
			candidate('recipes', 3, 140),
			candidate('dotfiles', 6, 400),
			candidate('thesis-2024', 11, 3000, { missing: true }),
		],
	});
	await page.goto('/');
	await page.getByTestId('add-project-menu').click();
	await page.getByTestId('open-import').click();
	const dialog = page.getByTestId('import-projects');
	await expect(dialog).toBeVisible();
	for (const name of ['billing-api', 'docs-site', 'homelab']) {
		await page.getByTestId(`import-row--home-ada-code-${name}`).getByRole('checkbox').click();
	}
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'first-run-import', await around([dialog], 16));
});
