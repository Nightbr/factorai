import { expect, test } from '@playwright/test';
import { installMockBridge, routineFixture } from '../smoke/fixtures';
import { around, Gif, shot } from './capture';
import { IDS, world } from './world';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The next local time at `hour:minute`, on `weekday` (0 = Sunday) if given —
 *  so the row's "next" agrees with the schedule it sits beside. */
function nextAt(hour: number, minute: number, weekday?: number): number {
	const d = new Date();
	d.setHours(hour, minute, 0, 0);
	while (d.getTime() <= Date.now() || (weekday !== undefined && d.getDay() !== weekday)) {
		d.setDate(d.getDate() + 1);
	}
	return d.getTime();
}

function fixture() {
	const w = world();
	const billing = w.sessionsByProject[IDS.billing];
	return {
		...w,
		routinesByProject: {
			[IDS.billing]: [
				routineFixture({
					id: 'routine-billing-nightly',
					projectId: IDS.billing,
					name: 'Nightly triage',
					cron: '0 2 * * *',
					prompt: 'Triage anything that failed on CI overnight and open an issue per root cause.',
					lastRunAt: Date.now() - 9 * HOUR,
					lastFireAt: Date.now() - 9 * HOUR,
					lastSessionId: billing[1].id,
					nextRunAt: nextAt(2, 0),
				}),
				routineFixture({
					id: 'routine-billing-deps',
					projectId: IDS.billing,
					name: 'Weekly dependency bump',
					cron: '30 9 * * 1',
					prompt: 'Bump patch and minor dependencies, run the tests, and summarise what changed.',
					lastRunAt: Date.now() - 4 * DAY,
					lastFireAt: Date.now() - 4 * DAY,
					nextRunAt: nextAt(9, 30, 1),
				}),
				routineFixture({
					id: 'routine-billing-invoices',
					projectId: IDS.billing,
					name: 'Reconcile last month’s invoices',
					cron: '0 7 1 * *',
					prompt: 'Compare Stripe invoices against the ledger for last month and list mismatches.',
					enabled: false,
					createdBySessionId: billing[0].id,
				}),
			],
		},
	};
}

test('routines: a project’s Routines tab', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}?tab=routines`);
	await expect(page.getByText('Weekly dependency bump')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	const list = page.getByTestId('routine-routine-billing-invoices').locator('..');
	const header = page.getByRole('heading', { name: 'billing-api' });
	await shot(
		page,
		'routines-list',
		await around([header, list, page.getByTestId('new-routine')], 20),
	);
});

test('routines: choosing a preset updates the next runs', async ({ page }) => {
	await installMockBridge(page, fixture());
	await page.goto(`/#/projects/${IDS.billing}?tab=routines`);
	await page.getByTestId('new-routine').click();
	const editor = page.getByTestId('routine-editor');
	await expect(editor).toBeVisible();
	await page.getByTestId('routine-name').fill('Morning digest');
	await page
		.getByTestId('routine-prompt')
		.fill('Summarise what merged overnight and anything still red on CI.');
	await page.getByTestId('routine-time').fill('7');
	await page.getByTestId('routine-time-minute').fill('30');
	await expect(page.getByTestId('routine-next')).toContainText('7:30');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);

	const clip = await around([editor], 12);
	const gif = new Gif(page, clip);
	await gif.frame(1800);
	await page.getByTestId('routine-preset').click();
	await expect(page.getByRole('option', { name: 'Weekly on' })).toBeVisible();
	await page.getByRole('option', { name: 'Weekly on' }).hover();
	await gif.frame(1100);
	await page.getByRole('option', { name: 'Weekly on' }).click();
	await expect(page.getByTestId('routine-weekday')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);
	await gif.frame(1500);
	await page.getByTestId('routine-weekday').click();
	await page.getByRole('option', { name: 'Friday' }).hover();
	await gif.frame(1000);
	await page.getByRole('option', { name: 'Friday' }).click();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.mouse.move(-10, -10);
	await gif.frame(2600);
	gif.save('routines-editor');
});
