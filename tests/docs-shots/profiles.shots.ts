import { expect, test } from '@playwright/test';
import { installMockBridge } from '../smoke/fixtures';
import { around, shot } from './capture';
import { IDS, world } from './world';

type Profiles = NonNullable<Parameters<typeof installMockBridge>[1]['profiles']>;

function profile(
	id: string,
	agent: 'claude' | 'codex',
	name: string,
	configDir: string,
	isDefault = false,
	isAppDefault = false,
): Profiles[number] {
	return {
		id,
		agent,
		name,
		configDir,
		isDefault,
		isAppDefault,
		missing: false,
		createdAt: Date.now() - 30 * 86_400_000,
	};
}

type Project = ReturnType<typeof world>['projects'][number];

/** The two "Pro" projects run under the Work profile. */
function onWork(p: Project): Project {
	return p.id === IDS.billing || p.id === IDS.docs
		? { ...p, profileId: 'profile-work', profileName: 'Work' }
		: p;
}

function fixture() {
	const w = world();
	return {
		...w,
		profiles: [
			profile('profile-default', 'claude', 'Default', '/home/ada/.claude', true, true),
			profile('profile-work', 'claude', 'Work', '/home/ada/.factorai/profiles/work'),
			profile('profile-client', 'claude', 'Client', '/home/ada/.factorai/profiles/client'),
			profile('profile-codex', 'codex', 'Default', '/home/ada/.codex', true),
		],
		projects: w.projects.map(onWork),
		sidebar: w.sidebar.map((r) =>
			r.kind === 'group'
				? { ...r, children: r.children.map((c) => ({ ...c, project: onWork(c.project) })) }
				: r,
		),
	};
}

test('profiles: Settings → Profiles with a few profiles', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto('/?settings=profiles');
	const modal = page.getByTestId('settings-modal');
	await expect(modal.getByTestId('profile-row-profile-client')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await shot(page, 'profiles-settings', (await modal.boundingBox()) ?? undefined);
});

test('profiles: the project menu’s Profile submenu', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto('/');
	const group = page.getByTestId('sidebar').getByText('Pro', { exact: true });
	await group.click();
	const row = page.getByTestId(`project-row-${IDS.billing}`);
	await expect(row).toBeVisible();
	await row.click({ button: 'right' });
	const trigger = page.getByTestId(`project-profile-${IDS.billing}`);
	await trigger.focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByText('Applies to new sessions')).toBeVisible();
	const menus = page.getByRole('menu');
	await expect(menus).toHaveCount(2);
	await shot(
		page,
		'profiles-project-menu',
		await around([group, row, menus.nth(0), menus.nth(1)], 16),
	);
});
