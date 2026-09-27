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

test('first-run: the empty workspace', async ({ page }) => {
	await installMockBridge(page, freshInstall());
	await page.goto('/');
	await expect(page.getByTestId('first-run')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	// The whole window: the point is where the doors are — the middle of it,
	// with the sidebar saying only the fact. Taken under reduced motion so
	// the halo is caught at its resting glow, not wherever the breath was.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await shot(page, 'first-run-empty');
});

test('first-run: the Import from… menu', async ({ page }) => {
	await installMockBridge(page, freshInstall());
	await page.goto('/');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.getByTestId('empty-open-import').click();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await shot(
		page,
		'first-run-import-menu',
		await around([page.getByTestId('empty-add-project'), menu], 28),
	);
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

test('first-run: the Import from Codex dialog', async ({ page }) => {
	await installMockBridge(page, {
		...freshInstall(),
		importCandidates: [
			candidate('billing-api', 4, 2, { agent: 'codex', key: `${HOME}/billing-api` }),
			candidate('homelab', 7, 30, { agent: 'codex', key: `${HOME}/homelab` }),
			candidate('scratch', 2, 200, { agent: 'codex', key: `${HOME}/scratch` }),
		],
	});
	await page.goto('/');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.getByTestId('empty-open-import').click();
	await page.getByRole('menuitem', { name: /^Codex/ }).click();
	const dialog = page.getByTestId('import-projects');
	await expect(dialog.getByRole('heading', { name: 'Import from Codex' })).toBeVisible();
	await dialog.getByTestId(`import-row-${HOME}/homelab`).getByRole('checkbox').click();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'first-run-import-codex', await around([dialog], 16));
});
