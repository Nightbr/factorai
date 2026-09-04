import { expect, test } from '@playwright/test';
import { FOO_ID, fixtureOneProjectOneSession, installMockBridge } from './fixtures';

/**
 * The Profiles section (specs/05-features.md F25).
 *
 * **One test, and it is the create-and-promote path.** That is the whole of the
 * feature a user drives by hand — the rest of it is Rust deciding what a spawn
 * inherits, which no browser lane can observe. The two refusals the section has
 * to *show* rather than swallow are in here too, because a form whose error path
 * is invisible is a form that looks like it did nothing.
 */
test.describe('profiles', () => {
	test('@smoke a second profile is created, promoted, and only then deletable', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureOneProjectOneSession());
		await page.goto('/?settings=profiles');

		const modal = page.getByTestId('settings-modal');
		await expect(modal).toBeVisible();
		// What every install has: the one profile `ensure_default` seeds.
		await expect(modal.getByTestId('profile-row-profile-default')).toBeVisible();
		await expect(modal.getByTestId('profile-default-profile-default')).toBeVisible();

		await modal.getByTestId('profiles-new').click();
		await modal.getByTestId('profile-name').fill('Work');
		// The directory is suggested from the name, so nothing is typed here — and
		// a suggestion that had to be corrected by hand would defeat the point.
		await expect(modal.getByTestId('profile-dir')).toHaveValue(
			'/home/mock/.factorai/profiles/work',
		);
		await modal.getByTestId('profile-create-submit').click();

		const work = modal.getByTestId('profile-row-profile-2');
		await expect(work).toBeVisible();
		await expect(work).toContainText('Work');
		// Created, not promoted: a new profile must not silently capture every
		// project that has no assignment of its own.
		await expect(modal.getByTestId('profile-default-profile-2')).toHaveCount(0);

		// A name already taken comes back as a message rather than a second row.
		await modal.getByTestId('profiles-new').click();
		await modal.getByTestId('profile-name').fill('Work');
		await modal.getByTestId('profile-create-submit').click();
		await expect(modal.getByTestId('profiles-error')).toContainText('name already exists');

		// **Deleting the default is refused**, and the reason sits where the action
		// would have been rather than arriving as an error after the click: every
		// project with no assignment resolves through it.
		await modal.getByTestId('profile-menu-profile-default').click();
		// Menu rows are `page`-level, not `modal`-level: Radix portals the content
		// to the body, so a locator scoped to the dialog never finds them.
		await expect(page.getByTestId('profile-delete-profile-default')).toBeDisabled();
		await page.keyboard.press('Escape');

		// Promote the new one; the old default is demoted in the same write, which
		// is the invariant the partial unique index holds in SQLite.
		await modal.getByTestId('profile-menu-profile-2').click();
		await page.getByTestId('profile-make-default-profile-2').click();
		await expect(modal.getByTestId('profile-default-profile-2')).toBeVisible();
		await expect(modal.getByTestId('profile-default-profile-default')).toHaveCount(0);

		// And now the *other* one is the deletable one. Two steps, because the row
		// is small and the click is easy to miss — not because the write is
		// dangerous: it removes a row and nothing on disk.
		await modal.getByTestId('profile-menu-profile-default').click();
		await page.getByTestId('profile-delete-profile-default').click();
		await modal.getByTestId('profile-delete-confirm').click();
		await expect(modal.getByTestId('profile-row-profile-default')).toHaveCount(0);
		await expect(modal.getByTestId('profile-row-profile-2')).toBeVisible();
	});

	test('@smoke a project is pointed at a profile from either side', async ({ page }) => {
		await installMockBridge(page, {
			...fixtureOneProjectOneSession(),
			profiles: [
				{
					id: 'profile-default',
					agent: 'claude',
					name: 'Personal',
					configDir: '/home/mock/.claude',
					isDefault: true,
					missing: false,
					createdAt: 0,
				},
				{
					id: 'profile-2',
					agent: 'claude',
					name: 'Work',
					configDir: '/home/mock/.claude-work',
					isDefault: false,
					missing: false,
					createdAt: 0,
				},
			],
		});
		await page.goto('/?settings=profiles');

		const modal = page.getByTestId('settings-modal');
		// Settings side: one profile, and the projects on it. `foo` starts on
		// neither — no assignment means the default.
		await modal.getByTestId('profile-projects-profile-2').click();
		const picker = modal.getByTestId('profile-project-picker-profile-2');
		await expect(picker.getByTestId(`assign-profile-2-${FOO_ID}`)).not.toBeChecked();
		await picker.getByTestId(`assign-profile-2-${FOO_ID}`).click();
		await expect(picker.getByTestId(`assign-profile-2-${FOO_ID}`)).toBeChecked();

		// The other side of the same row: the project's own menu reads the
		// assignment back, and it is where the "applies to new sessions" rule is
		// stated.
		await page.keyboard.press('Escape');
		await page.getByTestId(`project-row-${FOO_ID}`).click({ button: 'right' });
		const trigger = page.getByTestId(`project-profile-${FOO_ID}`);
		await expect(trigger).toContainText('Work');
		await trigger.click();
		await expect(page.getByText('Applies to new sessions')).toBeVisible();
		// Already there, so it is not an action: the menu says where the project is
		// rather than offering to put it where it already is.
		await expect(page.getByTestId(`project-profile-${FOO_ID}-profile-2`)).toBeDisabled();

		// And back to the default, which is a clear rather than an assignment.
		await page.getByTestId(`project-profile-default-${FOO_ID}`).click();
		await page.getByTestId(`project-row-${FOO_ID}`).click({ button: 'right' });
		await expect(page.getByTestId(`project-profile-${FOO_ID}`)).toContainText('Default');
	});
});
