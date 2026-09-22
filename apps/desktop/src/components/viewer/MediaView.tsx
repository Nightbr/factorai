import { BinaryCard, Centered, errorText } from '@components/viewer/chrome';
import type { MediaProbe } from '@factorai/types';
import { Button, IconButton } from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { mediaStackIsMissing } from '@lib/mediaSupport';
import { queryKeys } from '@lib/queryKeys';
import { cmd, openExternally } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import { useQuery } from '@tanstack/react-query';
import { hostIsShowing, useViewerHost } from '@components/viewer/viewerHost';
import { useViewerStore } from '@store/viewerStore';
import { ExternalLink, FileAudio, FileWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * `MediaError` codes. The spec numbers them and names them on the interface,
 * but `MediaError.MEDIA_ERR_DECODE` is only reachable from an instance, and the
 * instance is exactly what we do not have when deciding what to render.
 */
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;

/**
 * What to call a container in a sentence a reader can act on.
 *
 * The name and the extension together, because the two halves answer different
 * questions — *what is this* and *what do I search for* — and the failure this
 * mostly serves is a `.mkv` on macOS, where neither half alone is enough.
 */
const CONTAINER_NAMES: Record<string, string> = {
	'video/x-matroska': 'Matroska (.mkv)',
	'video/webm': 'WebM',
	'video/mp4': 'MP4',
	'video/quicktime': 'QuickTime (.mov)',
	'video/x-m4v': 'MPEG-4 video (.m4v)',
	'video/x-msvideo': 'AVI',
	'video/x-ms-asf': 'Windows Media (.wmv)',
	'video/x-ms-wmv': 'Windows Media (.wmv)',
	'video/x-flv': 'Flash Video (.flv)',
	'video/mpeg': 'MPEG program stream',
	'video/mp2t': 'MPEG transport stream',
	'video/ogg': 'Ogg video',
	'audio/x-ms-wma': 'Windows Media Audio (.wma)',
	'audio/mp4': 'MPEG-4 audio (.m4a)',
	'audio/mpeg': 'MP3',
	'audio/flac': 'FLAC',
	'audio/wav': 'WAV',
	'audio/aac': 'AAC',
	'audio/ogg': 'Ogg audio',
};

export function containerName(mime: string): string {
	return CONTAINER_NAMES[mime] ?? mime;
}

const GONE = 'The file could not be read — it may have been moved or deleted.';

/**
 * What the reader is told when the webview has no decoders at all (ADR-0059).
 *
 * Says it is the app rather than the file, because it is: every other media
 * file would fail the same way, and sending someone off to re-encode a working
 * `.mp4` would be the wrong afternoon.
 */
const NO_MEDIA_STACK =
	"This build can't play media — its video support is missing. Open the file in another app to play it.";

/**
 * The sentence for a media element that gave up, or `null` to keep playing.
 *
 * **`ABORTED` is not a failure**, it is what tearing the element down looks
 * like — closing the tab, switching file, navigating away — and reporting it
 * would flash an error card over a view that is already unmounting.
 *
 * **The element's code alone cannot tell a missing file from an unplayable
 * one.** A file that has gone since the probe makes the media server answer
 * `404`, and the element calls an unusable response `SRC_NOT_SUPPORTED` — the
 * same code it reports for a container it cannot demux. Blaming the codec for a
 * deleted file is exactly the wrong sentence in an app where an agent moves
 * files under the reader, so `status` carries what the transport said: the
 * caller asks for one byte and reports what came back. `null` means the check
 * itself could not be made, and the codec reading stands.
 *
 * `NETWORK` needs no status. It is a stream that died after starting, which
 * over a loopback socket means the file went away mid-read.
 *
 * Everything left is the webview declining the container, and naming it is what
 * helps, because this failure is platform-shaped rather than file-shaped
 * (specs/05-features.md F7 § "Video and audio"): Matroska does not demux in
 * WKWebView at all, so the same `.mkv` that plays on Linux lands here on macOS.
 */
export function mediaErrorMessage(
	code: number,
	mime: string,
	status: number | null,
): string | null {
	if (code === MEDIA_ERR_ABORTED) return null;
	if (code === MEDIA_ERR_NETWORK) return GONE;
	// Anything the transport refused is a transport problem, whatever the
	// element decided to call it.
	if (status !== null && (status < 200 || status >= 300)) return GONE;
	return `This webview can't decode ${containerName(mime)}. Open it in another app to play it.`;
}

/**
 * What the transport says about a source the element just refused — the status
 * of a one-byte range request, or `null` if even asking failed.
 *
 * One byte rather than a `HEAD`, because a range is what the server is built to
 * answer and what it has already been answering; a `HEAD` is a shape neither the
 * media server nor the smoke lane's intercept is written for.
 */
async function transportStatus(src: string): Promise<number | null> {
	try {
		const res = await fetch(src, { headers: { Range: 'bytes=0-0' } });
		return res.status;
	} catch {
		return null;
	}
}

/**
 * `2:41`, or `1:02:41` past an hour. Hours appear only when there are some, so
 * the common case does not carry a leading `0:` in a footer already competing
 * for width.
 */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '—';
	const whole = Math.round(seconds);
	const s = whole % 60;
	const m = Math.floor(whole / 60) % 60;
	const h = Math.floor(whole / 3600);
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** What the element told us about itself once it had read the header. */
interface MediaMeta {
	/** Absent for audio, and for a video whose header has no picture size. */
	width: number;
	height: number;
	/** Seconds. `Infinity` for a stream with no known end. */
	duration: number;
}

/**
 * One video or audio file, played (F7,
 * [ADR-0057](../../../../specs/adr/0057-media-is-served-over-loopback-http-not-a-custom-protocol.md)).
 *
 * **The bytes never come through this component.** `probe_media` answers with a
 * verdict, a URL and a size, and the element fetches the file itself from the
 * loopback media server in whatever ranges it wants — which is the whole reason
 * media does not take `ImageView`'s base64 road. Nothing here holds a frame.
 *
 * **Native controls, deliberately.** Transport, scrubbing, volume, buffering and
 * fullscreen are the webview's own and are correct on both platforms, at the
 * cost of looking like GTK on one and WebKit on the other. What we add is the
 * footer, which is `ImageView`'s row with different facts in it.
 *
 * **A file the webview cannot decode is the expected case, not the edge.** See
 * `mediaErrorMessage`.
 */
export function MediaView({ path }: { path: string }) {
	// Read off the element rather than the file, for the reason `ImageView`
	// reads `naturalWidth`: the browser parses the header anyway, and a second
	// answer from Rust could only disagree with it.
	const [meta, setMeta] = useState<MediaMeta | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const probeQ = useQuery({
		queryKey: queryKeys.media(path),
		// Reopening re-probes, and not only to re-read the facts: the answer
		// carries the URL the file was published at, so a cached probe is a
		// cached permission.
		queryFn: () => cmd.probeMedia(path),
		...REREAD_ON_OPEN,
		retry: false,
	});

	if (probeQ.isPending) return <Centered>Loading…</Centered>;
	if (probeQ.isError || !probeQ.data) {
		// Not media, or gone: the same card every other unopenable file gets,
		// which already offers the only action left.
		return <BinaryCard path={path} reason={errorText(probeQ.error)} />;
	}

	const probe = probeQ.data;
	// **Asked before the element is mounted, not after it fails** (ADR-0059). A
	// webview with no decoders does not report an error when handed a `<video>`
	// — it dies, taking the window with it. There is no `error` event to wait
	// for, so this is the one check that has to happen first.
	const stackMissing = mediaStackIsMissing();

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="media-stage"
				className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-4"
			>
				{stackMissing ? (
					<MediaFailureCard path={path} message={NO_MEDIA_STACK} />
				) : failure ? (
					<MediaFailureCard path={path} message={failure} />
				) : (
					<MediaElement
						path={path}
						probe={probe}
						onMeta={setMeta}
						onFailure={(code) => {
							if (code === MEDIA_ERR_ABORTED) return;
							// The status decides which sentence this is, so the card
							// waits for it rather than showing the wrong one first.
							void transportStatus(probe.url).then((status) =>
								setFailure(mediaErrorMessage(code, probe.mime, status)),
							);
						}}
					/>
				)}
			</div>

			<MediaFooter path={path} probe={probe} meta={meta} />
		</div>
	);
}

/**
 * Keep exactly one player decoding, and carry the position between them (F7).
 *
 * Both hosts are mounted while the modal is open — see `viewerHost.tsx` — so
 * without this, pressing expand leaves the pane's player running behind the
 * dialog: two decoders on one file, and two soundtracks a few hundred
 * milliseconds out of step.
 *
 * The player going off screen pauses and leaves its position in the store; the
 * one coming on seeks to it and, if the other was running, carries on. So an
 * expand is seamless rather than a restart, which is the whole reason the
 * position is carried at all.
 *
 * **`play()` may be refused** — a webview can decline playback it does not
 * consider user-initiated — and a refusal is left to stand. The reader sees a
 * paused player at the right timestamp and presses play, which is a much
 * better failure than an unhandled rejection.
 */
function useMediaHandover(ref: React.RefObject<HTMLMediaElement | null>, path: string) {
	const host = useViewerHost();
	const expanded = useViewerStore((s) => s.expanded);
	const handOver = useViewerStore((s) => s.handOverPlayback);
	const showing = hostIsShowing(host, expanded);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		if (!showing) {
			// Read before pausing: `pause()` does not move `currentTime`, but
			// reading first keeps this true whatever the element does next.
			handOver(path, { time: el.currentTime, playing: !el.paused });
			el.pause();
			return;
		}

		// Taking over. The position is read once, here, rather than subscribed
		// to: this player owns playback from now on, and a subscription would
		// yank its own timeline every time the other one wrote.
		const at = useViewerStore.getState().playback[path];
		if (!at) return;
		// Seeking before metadata has loaded throws away the seek, so wait for
		// the header when it is not there yet.
		const seek = () => {
			el.currentTime = at.time;
			if (at.playing) void el.play().catch(() => undefined);
		};
		if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
			seek();
			return;
		}
		el.addEventListener('loadedmetadata', seek, { once: true });
		return () => el.removeEventListener('loadedmetadata', seek);
	}, [showing, path, handOver, ref]);
}

/**
 * The element itself, video or audio.
 *
 * **Audio is the same view with the picture taken out**, not a component of its
 * own: a centred card carrying the file's own tree icon, its name, and the
 * controls under it. A `<video>` plays a `.wav` perfectly well and shows a black
 * rectangle doing it, which reads as a broken video rather than a sound file.
 */
function MediaElement({
	path,
	probe,
	onMeta,
	onFailure,
}: {
	path: string;
	probe: MediaProbe;
	onMeta: (meta: MediaMeta) => void;
	onFailure: (code: number) => void;
}) {
	// **The URL the probe answered with** (ADR-0057) — a loopback address naming
	// an opaque id and carrying the run's token. The renderer never builds it:
	// where the bytes live is the server's answer, and the path is for the
	// things that are about the file rather than its contents.
	const src = probe.url;
	const ref = useRef<HTMLMediaElement>(null);
	useMediaHandover(ref, path);
	const shared = {
		src,
		// `metadata` so the footer can fill without fetching the file. Nothing
		// plays until asked: a single click in the tree opens a preview tab, and
		// a preview that starts making noise is the wrong default in a window
		// whose foreground job is a terminal.
		preload: 'metadata' as const,
		controls: true,
		// The element's own `error` fires for a failed *load*; a `<source>` child
		// would swallow it, which is why the src is an attribute here.
		onError: (e: { currentTarget: HTMLMediaElement }) =>
			onFailure(e.currentTarget.error?.code ?? 0),
		onLoadedMetadata: (e: { currentTarget: HTMLMediaElement }) => {
			const el = e.currentTarget;
			onMeta({
				width: el instanceof HTMLVideoElement ? el.videoWidth : 0,
				height: el instanceof HTMLVideoElement ? el.videoHeight : 0,
				duration: el.duration,
			});
		},
	};

	if (probe.kind === 'audio') {
		return (
			<div className="flex flex-col items-center gap-3 px-6 text-center">
				{/* lucide, not the tree's `FileIcon` — this is viewer chrome, which
				    speaks the same vocabulary as the binary card beside it, and
				    `lib/fileIcon.ts` is deliberately free of icon imports so it
				    still unit-tests without the Vite icon plugin. */}
				<FileAudio className="size-10 shrink-0 text-muted-foreground/60" />
				<span className="max-w-full truncate text-sm">{basename(path)}</span>
				<audio
					ref={ref as React.RefObject<HTMLAudioElement>}
					data-testid="media-element"
					className="w-72 max-w-full"
					{...shared}
				/>
			</div>
		);
	}

	return (
		<video
			ref={ref as React.RefObject<HTMLVideoElement>}
			data-testid="media-element"
			className="max-h-full max-w-full object-contain"
			{...shared}
		/>
	);
}

/**
 * The card that replaces the player when the webview will not decode the file.
 *
 * Shaped like `BinaryCard` and carrying its action, but not *it*: that one says
 * "Cannot preview binary file", which is a true sentence about a different
 * problem. This is a file we deliberately tried to play and could not, and the
 * reason is worth a sentence.
 */
function MediaFailureCard({ path, message }: { path: string; message: string }) {
	return (
		<div
			data-testid="media-error"
			className="flex flex-col items-center justify-center gap-3 px-6 text-center"
		>
			<FileWarning className="size-8 text-muted-foreground/60" />
			<p className="text-muted-foreground text-sm">{message}</p>
			<Button variant="outline" size="sm" onClick={() => void openExternally(path)}>
				Open in default app
			</Button>
		</div>
	);
}

/**
 * `mime · dimensions · duration · size`, as one string (F7).
 *
 * One truncating span for the reason `ImageView`'s is one: the column can be
 * dragged to 400px and the facts have to ellipsize as a unit rather than
 * wrapping. The action keeps its glyph longest and the metadata truncates last,
 * which is the order F7's footer rules already set.
 *
 * The footer survives a failure — a file that will not play still has a type and
 * a size, and those are the facts a reader is about to go looking for.
 */
function MediaFooter({
	path,
	probe,
	meta,
}: {
	path: string;
	probe: MediaProbe;
	meta: MediaMeta | null;
}) {
	const facts = [
		probe.mime,
		// Audio has no picture, and a video header can report 0×0 before a frame
		// is decoded — neither is worth a `0 × 0` in the footer.
		meta && meta.width > 0 ? `${meta.width} × ${meta.height}` : null,
		meta ? formatDuration(meta.duration) : null,
		formatBytes(probe.size),
	].filter(Boolean);

	return (
		<footer className="flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-border px-3 text-muted-foreground text-xs">
			<span className="min-w-0 truncate" data-testid="media-facts">
				{facts.join(' · ')}
			</span>
			<span className="flex-1" />
			<IconButton
				aria-label="Open in default app"
				title="Open in default app"
				onClick={() => void openExternally(path)}
			>
				<ExternalLink />
			</IconButton>
		</footer>
	);
}

function basename(path: string): string {
	const i = path.lastIndexOf('/');
	return i >= 0 ? path.slice(i + 1) : path;
}
