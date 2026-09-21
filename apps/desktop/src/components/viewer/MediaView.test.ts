import { containerName, formatDuration, mediaErrorMessage } from '@components/viewer/MediaView';
import { iconKeyFor } from '@lib/fileIcon';
import { describe, expect, it } from 'vitest';

describe('mediaErrorMessage', () => {
	it('says nothing for an abort, which is what a close looks like', () => {
		// Code 1 is MEDIA_ERR_ABORTED. Reporting it would flash an error card
		// over a view that is already unmounting.
		expect(mediaErrorMessage(1, 'video/mp4')).toBeNull();
	});

	it('blames the file, not the codec, for a network error', () => {
		// There is no network behind the asset protocol, so this one means the
		// file moved or went away.
		expect(mediaErrorMessage(2, 'video/mp4')).toMatch(/moved or deleted/);
	});

	it('names the container for a decode failure, because that is the fix', () => {
		// The failure this mostly serves: a .mkv on macOS, where WKWebView will
		// not demux Matroska at all.
		const message = mediaErrorMessage(3, 'video/x-matroska');
		expect(message).toContain('Matroska (.mkv)');
		expect(message).toMatch(/another app/);
	});

	it('treats an unsupported source the same as a failed decode', () => {
		// Refused at the first byte and dying mid-stream leave the reader with
		// the same problem, so they get the same sentence.
		expect(mediaErrorMessage(4, 'video/webm')).toEqual(mediaErrorMessage(3, 'video/webm'));
	});

	it('falls back to the mime rather than inventing a name', () => {
		expect(containerName('video/x-unheard-of')).toBe('video/x-unheard-of');
		expect(mediaErrorMessage(3, 'video/x-unheard-of')).toContain('video/x-unheard-of');
	});
});

describe('formatDuration', () => {
	it('pads the seconds and drops the empty hour', () => {
		expect(formatDuration(161)).toBe('2:41');
		expect(formatDuration(9)).toBe('0:09');
		expect(formatDuration(0)).toBe('0:00');
	});

	it('shows hours only when there are some', () => {
		expect(formatDuration(3761)).toBe('1:02:41');
		expect(formatDuration(3600)).toBe('1:00:00');
	});

	it('refuses to print a duration the element never knew', () => {
		// A live stream reports Infinity, and a header the demuxer could not
		// read reports NaN. Neither is a time.
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
		expect(formatDuration(Number.NaN)).toBe('—');
		expect(formatDuration(-1)).toBe('—');
	});
});

describe('what routes to the player', () => {
	it('sends the common video and audio containers there', () => {
		for (const name of [
			'clip.mkv',
			'clip.mp4',
			'clip.m4v',
			'clip.mov',
			'clip.webm',
			'clip.avi',
			'clip.ogv',
			'clip.mpg',
			'clip.mpeg',
			'clip.wmv',
			'clip.flv',
			'clip.m2ts',
			'clip.mts',
		]) {
			expect(iconKeyFor(name), name).toBe('video');
		}
		for (const name of [
			'song.mp3',
			'song.wav',
			'song.flac',
			'song.aac',
			'song.ogg',
			'song.opus',
			'song.m4a',
			'song.wma',
		]) {
			expect(iconKeyFor(name), name).toBe('audio');
		}
	});

	it('never sends TypeScript there', () => {
		// `.ts` is MPEG-TS to the rest of the world and TypeScript in every
		// project this app opens; `m2ts` / `mts` are the unambiguous spellings.
		// Mirrors `typescript_is_never_a_video` in services/files.rs.
		expect(iconKeyFor('store.ts')).toBe('typescript');
		expect(iconKeyFor('view.tsx')).toBe('reactts');
	});

	it('leaves the pictures to the image view', () => {
		// `.gif` animates and `.svg` is source; neither is media here, for the
		// reasons `read_image` already gives.
		expect(iconKeyFor('loop.gif')).toBe('image');
		expect(iconKeyFor('logo.svg')).toBe('svg');
		expect(iconKeyFor('shot.webp')).toBe('image');
	});
});
