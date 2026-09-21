import { containerName, formatDuration, mediaErrorMessage } from '@components/viewer/MediaView';
import { iconKeyFor } from '@lib/fileIcon';
import { describe, expect, it } from 'vitest';

describe('mediaErrorMessage', () => {
	it('says nothing for an abort, which is what a close looks like', () => {
		// Code 1 is MEDIA_ERR_ABORTED. Reporting it would flash an error card
		// over a view that is already unmounting.
		expect(mediaErrorMessage(1, 'video/mp4', 206)).toBeNull();
	});

	it('blames the file, not the codec, for a stream that died', () => {
		// Code 2 is MEDIA_ERR_NETWORK. There is no network behind the asset
		// protocol, so it means the file went away mid-read.
		expect(mediaErrorMessage(2, 'video/mp4', null)).toMatch(/moved or deleted/);
	});

	it('names the container for a decode failure the transport served fine', () => {
		// The failure this mostly serves: a .mkv on macOS, where WKWebView will
		// not demux Matroska at all. 206 means the bytes arrived — so the codec
		// really is the problem.
		const message = mediaErrorMessage(3, 'video/x-matroska', 206);
		expect(message).toContain('Matroska (.mkv)');
		expect(message).toMatch(/another app/);
	});

	it('blames the file when the transport refused it, whatever the element said', () => {
		// The bug this exists for: a file deleted between the probe and the
		// fetch makes the protocol answer 404, and the element reports that as
		// SRC_NOT_SUPPORTED — the same code an undecodable container gets.
		// Saying "can't decode MP4" about a file that is simply gone is the
		// wrong sentence, and in this app an agent deleting a file under the
		// reader is ordinary.
		expect(mediaErrorMessage(4, 'video/mp4', 404)).toMatch(/moved or deleted/);
		expect(mediaErrorMessage(4, 'video/mp4', 403)).toMatch(/moved or deleted/);
		expect(mediaErrorMessage(3, 'video/mp4', 500)).toMatch(/moved or deleted/);
	});

	it('falls back to the codec reading when the status could not be had', () => {
		// `null` is "we could not even ask". Guessing the file is gone on no
		// evidence would be the same mistake in the other direction.
		expect(mediaErrorMessage(4, 'video/webm', null)).toMatch(/can't decode WebM/);
	});

	it('treats an unsupported source the same as a failed decode', () => {
		// Refused at the first byte and dying mid-stream leave the reader with
		// the same problem, so they get the same sentence.
		expect(mediaErrorMessage(4, 'video/webm', 206)).toEqual(
			mediaErrorMessage(3, 'video/webm', 206),
		);
	});

	it('falls back to the mime rather than inventing a name', () => {
		expect(containerName('video/x-unheard-of')).toBe('video/x-unheard-of');
		expect(mediaErrorMessage(3, 'video/x-unheard-of', 200)).toContain('video/x-unheard-of');
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
