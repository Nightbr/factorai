import { BinaryCard, Centered, errorText } from '@components/viewer/chrome';
import type { MediaProbe } from '@factorai/types';
import { Button, IconButton } from '@factorai/ui';
import { formatBytes } from '@lib/format';
import { queryKeys } from '@lib/queryKeys';
import { cmd, mediaSrc, openExternally } from '@lib/tauri';
import { REREAD_ON_OPEN } from '@lib/viewerQuery';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileAudio, FileWarning } from 'lucide-react';
import { useState } from 'react';

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

/**
 * The sentence for a media element that gave up, or `null` to keep playing.
 *
 * **`ABORTED` is not a failure**, it is what tearing the element down looks
 * like — closing the tab, switching file, navigating away — and reporting it
 * would flash an error card over a view that is already unmounting.
 *
 * `NETWORK` is the only code with a cause outside the codec. Over the asset
 * protocol there is no network, so it means the file moved, was deleted, or the
 * grant no longer matches — all of which the reader fixes the same way.
 *
 * Everything else — `DECODE`, `SRC_NOT_SUPPORTED` — is the webview declining the
 * container, and the two are not worth telling apart: a half-supported format
 * that dies mid-stream and one refused at the first byte leave the reader with
 * the same problem. Naming the container is what helps, because this failure is
 * platform-shaped rather than file-shaped (specs/05-features.md F7 § "Video and
 * audio"): Matroska does not demux in WKWebView at all, so the same `.mkv` that
 * plays on Linux lands here on macOS.
 */
export function mediaErrorMessage(code: number, mime: string): string | null {
	if (code === MEDIA_ERR_ABORTED) return null;
	if (code === MEDIA_ERR_NETWORK) {
		return 'The file could not be read — it may have been moved or deleted.';
	}
	return `This webview can't decode ${containerName(mime)}. Open it in another app to play it.`;
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
 * [ADR-0056](../../../../specs/adr/0056-the-asset-protocol-carries-media-one-file-at-a-time.md)).
 *
 * **The bytes never come through this component.** `probe_media` answers with a
 * verdict, a canonical path and a size, and the element fetches the file itself
 * over the asset protocol in whatever ranges it wants — which is the whole
 * reason media does not take `ImageView`'s base64 road. Nothing here holds a
 * frame.
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
		// carries the asset-protocol grant, so a cached probe is a cached
		// permission.
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

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="media-stage"
				className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-4"
			>
				{failure ? (
					<MediaFailureCard path={path} message={failure} />
				) : (
					<MediaElement
						path={path}
						probe={probe}
						onMeta={setMeta}
						onFailure={(code) => setFailure(mediaErrorMessage(code, probe.mime))}
					/>
				)}
			</div>

			<MediaFooter path={path} probe={probe} meta={meta} />
		</div>
	);
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
	// **The canonical path, not the one we were asked about** (ADR-0056). That
	// is the path `probe_media` granted, and the protocol canonicalizes an
	// incoming request before matching it — so a file reached through a symlink
	// is refused if we ask for the name we started with.
	const src = mediaSrc(probe.path);
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
				<audio data-testid="media-element" className="w-72 max-w-full" {...shared} />
			</div>
		);
	}

	return (
		<video
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
