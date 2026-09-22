/**
 * Whether this webview has a media stack at all (specs/05-features.md F7,
 * [ADR-0059](../../../../specs/adr/0059-a-dead-web-process-is-reloaded-not-left-on-screen.md)).
 *
 * **Not "can it play this file".** That question is deliberately left to the
 * element, and ADR-0057 says why: `canPlayType` answers `probably` for files
 * that then fail, and empty for containers a demuxer handles perfectly well —
 * `video/x-matroska` among them. Refusing a file on its own `canPlayType` would
 * ground the `.mkv` that F7 exists to play.
 *
 * This asks a different, much blunter question, and one `canPlayType` *is*
 * reliable for: **is there a decoder here for anything?** A WebKitGTK with no
 * GStreamer plugins answers empty for every type in existence, because its MIME
 * registry is built from the plugins it found and it found none. A working
 * build answers `maybe` or `probably` for at least the formats below — measured
 * on 2026-09-22 in a WebKitGTK 4.1 view, with plugins and with the plugin path
 * pointed at an empty directory:
 *
 * | type | plugins present | no plugins |
 * |---|---|---|
 * | `video/mp4; codecs="avc1.42E01E"` | `probably` | `` |
 * | `video/mp4` | `maybe` | `` |
 * | `video/webm` | `maybe` | `` |
 * | `audio/mpeg` | `maybe` | `` |
 * | `audio/wav` | `maybe` | `` |
 *
 * **Why it is worth asking at all**: mounting an element in the second state
 * does not fail, it *kills the web process* — WebKit connects a signal to the
 * `NULL` element factory and the whole renderer goes, which the reader sees as
 * the window freezing. ADR-0058 fixed the cause on the platform where it
 * happened; this is the belt to that braces, and the only thing standing
 * between a future packaging mistake and a frozen window.
 */

/**
 * Types any build with a working media stack recognises.
 *
 * Every one of them, not one: a single format could plausibly be missing on a
 * stripped-down system and that is not this failure. All five empty is a
 * registry with nothing in it.
 */
const CANARIES = [
	{ kind: 'video', type: 'video/mp4; codecs="avc1.42E01E"' },
	{ kind: 'video', type: 'video/mp4' },
	{ kind: 'video', type: 'video/webm' },
	{ kind: 'audio', type: 'audio/mpeg' },
	{ kind: 'audio', type: 'audio/wav' },
] as const;

/**
 * Asked once per run and remembered. Plugins do not arrive while the app is
 * open, and the answer costs two throwaway elements.
 */
let cached: boolean | undefined;

/**
 * `true` when this webview cannot decode *anything*, which means mounting a
 * player would take the renderer down rather than show an error.
 *
 * Fails open. If the check itself throws — a `document` that is not there, an
 * element that will not construct — the answer is `false` and the element is
 * mounted, because a guard that grounds media on its own bugs is worse than the
 * failure it guards against.
 */
export function mediaStackIsMissing(): boolean {
	if (cached !== undefined) return cached;
	cached = probe();
	return cached;
}

function probe(): boolean {
	try {
		const video = document.createElement('video');
		const audio = document.createElement('audio');
		return CANARIES.every(({ kind, type }) => {
			const el = kind === 'audio' ? audio : video;
			// Spec says `''` for "no", `'maybe'` or `'probably'` otherwise. A
			// webview that does not implement it at all is not one we can judge.
			if (typeof el.canPlayType !== 'function') return false;
			return el.canPlayType(type) === '';
		});
	} catch {
		return false;
	}
}

/** Testing seam: forget the cached answer. Nothing in the app calls this. */
export function resetMediaSupportCache(): void {
	cached = undefined;
}
