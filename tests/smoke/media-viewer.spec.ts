import { type Page, expect, test } from '@playwright/test';
import { fixtureWithFileTree, installMockBridge } from './fixtures';

/**
 * Video and audio in the file viewer (F7, ADR-0057).
 *
 * These run against real media: the fixtures under `fixtures/media/` are a
 * genuine H.264 clip, a VP9 clip and an MP3, served over a route intercept that
 * answers ranges the way the media server does. Chromium actually decodes
 * them, so a `<video>` that mounts but never plays fails here.
 *
 * **What they cannot prove is that a `.mkv` plays.** Chromium will not demux
 * Matroska either, so the one format most likely to fail for a user is beyond
 * this lane by construction — it is manual QA on both platforms, and the error
 * card below is what it falls back to.
 */

/** Open the project, reveal the tree, and click through to a file in it. */
async function openFile(page: Page, name: string) {
	await page.locator('aside').first().getByText('foo').click();
	await page.getByRole('button', { name: 'Toggle file tree' }).click();
	await page.getByTestId('file-tree-panel').getByRole('button', { name }).click();
	const viewer = page.getByTestId('file-viewer');
	await expect(viewer).toBeVisible();
	return viewer;
}

test.describe('media viewer', () => {
	test('@smoke a video plays, and the footer carries its facts', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openFile(page, 'clip.mp4');
		const video = viewer.getByTestId('media-element');
		await expect(video).toBeVisible();

		// It decoded: a real picture size and a real duration, both read off the
		// element on `loadedmetadata` rather than parsed in Rust.
		await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(160);
		await expect
			.poll(() => video.evaluate((el: HTMLMediaElement) => el.readyState))
			.toBeGreaterThanOrEqual(1);

		// mime · dimensions · duration · size, as one string.
		await expect(viewer.getByTestId('media-facts')).toHaveText(
			'video/mp4 · 160 × 120 · 0:01 · 4.8 KB',
		);

		// Not Monaco, and not the binary card: a video must reach neither.
		await expect(viewer.getByTestId('file-view-editor')).toHaveCount(0);
		await expect(viewer.getByTestId('binary-card')).toHaveCount(0);
	});

	test('@smoke nothing plays until asked', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openFile(page, 'clip.webm');
		const video = viewer.getByTestId('media-element');
		await expect(video).toBeVisible();

		// A single click in the tree opens a preview tab; a preview tab that
		// starts making noise is the wrong default beside a terminal (F7).
		await expect.poll(() => video.evaluate((el: HTMLMediaElement) => el.paused)).toBe(true);
		expect(await video.evaluate((el: HTMLMediaElement) => el.autoplay)).toBe(false);
		expect(await video.evaluate((el: HTMLMediaElement) => el.loop)).toBe(false);
		expect(await video.evaluate((el: HTMLMediaElement) => el.preload)).toBe('metadata');
	});

	test('@smoke an audio file gets a card rather than a black rectangle', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openFile(page, 'song.mp3');
		const audio = viewer.getByTestId('media-element');
		await expect(audio).toBeVisible();

		// An `<audio>`, not a `<video>` playing a sound file into a black box.
		expect(await audio.evaluate((el: HTMLElement) => el.tagName)).toBe('AUDIO');
		// No dimensions in the footer — there is no picture to size.
		await expect(viewer.getByTestId('media-facts')).toHaveText('audio/mpeg · 0:01 · 4.3 KB');
	});

	test('@smoke a file the probe refuses falls to the binary card', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		// `notreally.mp4` is in the tree and not in `media`, which is how a
		// fixture says "the bytes are not what the extension claims".
		const viewer = await openFile(page, 'notreally.mp4');

		await expect(viewer.getByTestId('binary-card')).toBeVisible();
		await expect(viewer.getByTestId('media-element')).toHaveCount(0);
	});

	test('@smoke a file the element cannot fetch says so and offers the way out', async ({
		page,
	}) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		// Probed fine, then served as a 404 — the shape of a file moved or
		// deleted between the probe and the fetch.
		const viewer = await openFile(page, 'vanished.mp4');

		const card = viewer.getByTestId('media-error');
		await expect(card).toBeVisible();
		await expect(card).toContainText('moved or deleted');
		await expect(card.getByRole('button', { name: 'Open in default app' })).toBeVisible();
		// The facts survive the failure: the file still has a type and a size.
		await expect(viewer.getByTestId('media-facts')).toContainText('video/mp4');
	});

	test('@smoke a webview with no decoders says so instead of mounting a player', async ({
		page,
	}) => {
		// **The failure that froze the app, standing in for a bundle that cannot
		// be built here** (ADR-0058, ADR-0059). A WebKitGTK with no GStreamer
		// plugins answers `''` for every type and then *kills its own process*
		// when handed a `<video>` — there is no error event, so the element must
		// never be mounted at all. Chromium always has decoders, so the only way
		// to reach that state in this lane is to take `canPlayType` away.
		await page.addInitScript(() => {
			HTMLMediaElement.prototype.canPlayType = () => '';
		});
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openFile(page, 'clip.mp4');

		const card = viewer.getByTestId('media-error');
		await expect(card).toBeVisible();
		await expect(card).toContainText("can't play media");
		await expect(card.getByRole('button', { name: 'Open in default app' })).toBeVisible();
		// The element is what kills the process, so the assertion that matters is
		// that it is not there.
		await expect(viewer.getByTestId('media-element')).toHaveCount(0);
		// The footer still carries the file's facts — they are true either way.
		await expect(viewer.getByTestId('media-facts')).toContainText('video/mp4');
	});

	test('@smoke expanding hands playback over rather than doubling it', async ({ page }) => {
		await installMockBridge(page, fixtureWithFileTree());
		await page.goto('/');

		const viewer = await openFile(page, 'clip.mp4');
		const pane = viewer.getByTestId('media-element');
		await expect(pane).toBeVisible();

		// Get it actually running and a little way in, so the handover has both
		// a state and a position to carry.
		await pane.evaluate(async (el: HTMLMediaElement) => {
			el.currentTime = 0.4;
			await el.play();
		});
		await expect.poll(() => pane.evaluate((el: HTMLMediaElement) => el.paused)).toBe(false);

		await page.getByTestId('viewer-expand').click();

		// Both hosts stay mounted, so both elements exist. Exactly one runs —
		// two decoders on one file is two soundtracks a few hundred
		// milliseconds apart, which is the bug this guards.
		const players = page.getByTestId('media-element');
		await expect.poll(() => players.count()).toBeGreaterThan(1);
		await expect
			.poll(async () => {
				const paused = await players.evaluateAll((els) =>
					els.map((el) => (el as HTMLMediaElement).paused),
				);
				return paused.filter((p) => !p).length;
			})
			.toBe(1);

		// And it carried on from where the other one was, rather than restarting.
		const times = await players.evaluateAll((els) =>
			els.map((el) => (el as HTMLMediaElement).currentTime),
		);
		expect(Math.max(...times)).toBeGreaterThan(0.3);
	});
});
