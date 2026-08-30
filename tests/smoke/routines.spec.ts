import { expect, test } from '@playwright/test';
import { FOO_ID, fixtureOneProjectOneSession, installMockBridge, routineFixture } from './fixtures';

/**
 * Routines — a project's scheduled prompts (specs/05-features.md F22).
 *
 * What these cover is the surface a schedule is configured from: the tab that
 * holds it, the editor's preset picker with its `Custom…` escape, the next-run
 * echo that is the only defence against a schedule which silently never fires,
 * and the two rules a routine's controls have to obey — a disable that stops
 * future fires and nothing else, and a delete that asks first.
 *
 * The runner itself is Rust and has its own tests; nothing here fires anything.
 */
const NIGHTLY = routineFixture();

function fixture(routines = [NIGHTLY]) {
	return { ...fixtureOneProjectOneSession(), routinesByProject: { [FOO_ID]: routines } };
}

test.describe('the project has two lists', () => {
	test('@smoke the Routines tab is reachable, and the URL says which one you are on', async ({
		page,
	}) => {
		await installMockBridge(page, fixture());
		await page.goto(`/#/projects/${FOO_ID}`);

		// Sessions is what a project is mostly about, so it is where an unadorned
		// URL lands.
		await expect(page.getByTestId('project-tab-sessions')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByText('Refactor the auth middleware')).toBeVisible();

		await page.getByTestId('project-tab-routines').click();
		await expect(page).toHaveURL(/tab=routines/);
		await expect(page.getByText('Nightly triage')).toBeVisible();
		// The schedule reads as words, not as five fields.
		await expect(page.getByText('Every day at 2:00')).toBeVisible();
		// `New session` belongs to the sessions list and goes with it. Exact, or
		// the sidebar's own "New session in foo" answers instead.
		await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeHidden();
	});

	test('@smoke a deep link opens the Routines tab directly', async ({ page }) => {
		await installMockBridge(page, fixture());
		// The URL the context menu's `New routine` navigates to.
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);
		await expect(page.getByTestId('project-tab-routines')).toHaveAttribute('aria-selected', 'true');
	});

	test('@smoke a project with no routines gets a hero, not a grey sentence', async ({ page }) => {
		await installMockBridge(page, fixture([]));
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);
		await expect(page.getByText('No routines yet')).toBeVisible();
		// The hero carries the action it is empty of, as well as the header's.
		await expect(page.getByTestId('new-routine-empty')).toBeVisible();
	});
});

test.describe('the editor', () => {
	test('@smoke creates a routine from the preset picker, and the list shows it', async ({
		page,
	}) => {
		await installMockBridge(page, fixture([]));
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		// The button is in the page header, where `New session` is.
		await page.getByTestId('new-routine').click();
		await page.getByTestId('routine-name').fill('Morning digest');
		await page.getByTestId('routine-prompt').fill('Summarise what changed overnight.');
		await page.getByTestId('routine-time').fill('7');
		await page.getByTestId('routine-time-minute').fill('30');
		// The echo is the point of the field: it says when this will actually run.
		await expect(page.getByTestId('routine-next')).toContainText('7:30');

		await page.getByTestId('routine-save').click();
		await expect(page.getByTestId('routine-editor')).toBeHidden();
		await expect(page.getByText('Morning digest')).toBeVisible();
		await expect(page.getByText('Every day at 7:30')).toBeVisible();
	});

	test('@smoke `Custom…` carries the expression the presets were producing', async ({ page }) => {
		await installMockBridge(page, fixture([]));
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		await page.getByTestId('new-routine').click();
		await page.getByTestId('routine-time').fill('18');
		await page.getByTestId('routine-time-minute').fill('0');
		await page.getByTestId('routine-preset').click();
		await page.getByRole('option', { name: 'Custom…' }).click();
		// Starting from what you had rather than from an empty field.
		await expect(page.getByTestId('routine-cron')).toHaveValue('0 18 * * *');

		// A form the projection does not model says so instead of guessing.
		await page.getByTestId('routine-cron').fill('0 18 * * 1-5');
		await expect(page.getByTestId('routine-next')).toContainText('Saved routines show');
	});

	test('@smoke refuses a cron expression the backend cannot parse', async ({ page }) => {
		await installMockBridge(page, fixture([]));
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		await page.getByTestId('new-routine').click();
		await page.getByTestId('routine-name').fill('Broken');
		await page.getByTestId('routine-prompt').fill('Never runs.');
		await page.getByTestId('routine-preset').click();
		await page.getByRole('option', { name: 'Custom…' }).click();
		await page.getByTestId('routine-cron').fill('every tuesday');
		await page.getByTestId('routine-save').click();

		// The editor stays open with the reason on it — a schedule that could
		// never fire is the failure this feature can least explain afterwards.
		await expect(page.getByTestId('routine-error')).toContainText('not a cron expression');
		await expect(page.getByTestId('routine-editor')).toBeVisible();
	});
});

test.describe('a routine’s controls', () => {
	test('@smoke the switch stops future fires and the row says it is off', async ({ page }) => {
		await installMockBridge(page, fixture());
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		await page.getByTestId(`routine-toggle-${NIGHTLY.id}`).click();
		await expect(page.getByText('disabled')).toBeVisible();
	});

	test('@smoke deleting asks first, and says the running session survives it', async ({ page }) => {
		await installMockBridge(page, fixture());
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		await page.getByTestId(`routine-delete-${NIGHTLY.id}`).click();
		await expect(page.getByText('A session it started keeps running.')).toBeVisible();

		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByText('Nightly triage')).toBeVisible();

		await page.getByTestId(`routine-delete-${NIGHTLY.id}`).click();
		await page.getByTestId(`routine-delete-confirm-${NIGHTLY.id}`).click();
		await expect(page.getByText('No routines yet')).toBeVisible();
	});

	test('@smoke a failed run says why, on the row', async ({ page }) => {
		// The copy that survives being away from the machine — a toast does not.
		await installMockBridge(
			page,
			fixture([{ ...NIGHTLY, lastError: 'the project folder is gone' }]),
		);
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);
		await expect(page.getByTestId(`routine-error-${NIGHTLY.id}`)).toContainText(
			'the project folder is gone',
		);
	});

	test('@smoke a skipped fire says the previous session was still running', async ({ page }) => {
		await installMockBridge(
			page,
			fixture([
				{ ...NIGHTLY, lastRunAt: Date.now() - 7_200_000, lastSkippedAt: Date.now() - 60_000 },
			]),
		);
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);
		await expect(page.getByText('the previous session was still running')).toBeVisible();
	});
});

test.describe('the project context menu', () => {
	test('@smoke offers New session and New routine, and New routine lands on the tab', async ({
		page,
	}) => {
		await installMockBridge(page, fixture());
		await page.goto('/');

		await page.getByTestId(`project-row-${FOO_ID}`).click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'New session' })).toBeVisible();
		await page.getByRole('menuitem', { name: 'New routine' }).click();

		await expect(page).toHaveURL(new RegExp(`projects/${FOO_ID}\\?tab=routines`));
		await expect(page.getByTestId('project-tab-routines')).toHaveAttribute('aria-selected', 'true');
	});
});

test.describe('the clock setting', () => {
	test('@smoke switching to AM/PM changes the schedule and the editor’s own field', async ({
		page,
	}) => {
		await installMockBridge(page, fixture());
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);
		await expect(page.getByText('Every day at 2:00')).toBeVisible();

		// Appearance is the section this setting created; it was empty until it.
		await page.goto(`/#/projects/${FOO_ID}?tab=routines&settings=appearance`);
		await page.getByTestId('settings-clock24').click();
		await page.getByTestId('settings-save').click();

		await expect(page.getByText('Every day at 2:00 AM')).toBeVisible();

		// And the editor's field, which is ours precisely so it can follow this —
		// a native time input renders on the browser's locale instead.
		await page.getByTestId('new-routine').click();
		await expect(page.getByTestId('routine-time-meridiem')).toBeVisible();
	});
});

test.describe('a routine an agent touched', () => {
	// Slice 3 lets an agent write a schedule over the IDE bridge (ADR-0028),
	// which makes "who wrote this" a question the list has to be able to answer.
	// The mark is the visible half of that; migration 0014 is the durable one.
	test('@smoke is marked, and one a human wrote is not', async ({ page }) => {
		await installMockBridge(
			page,
			fixture([
				routineFixture({ id: 'r-human', name: 'Written by hand' }),
				routineFixture({
					id: 'r-agent',
					name: 'Written by an agent',
					createdBySessionId: 'session-abc',
				}),
			]),
		);
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		const marks = page.getByTestId('routine-agent-touched');
		await expect(marks).toHaveCount(1);
		await expect(
			page.getByTestId('routine-r-agent').getByTestId('routine-agent-touched'),
		).toHaveAttribute('title', /Created by an agent session/);
	});

	test('@smoke a human’s routine an agent amended says so rather than looking untouched', async ({
		page,
	}) => {
		// The case a single `createdBy` column cannot record — and the reason
		// there are two. An agent switching off your nightly digest would
		// otherwise leave the row exactly as you left it.
		await installMockBridge(
			page,
			fixture([routineFixture({ id: 'r-amended', lastModifiedBySessionId: 'session-abc' })]),
		);
		await page.goto(`/#/projects/${FOO_ID}?tab=routines`);

		await expect(
			page.getByTestId('routine-r-amended').getByTestId('routine-agent-touched'),
		).toHaveAttribute('title', /Last changed by an agent session/);
	});
});
