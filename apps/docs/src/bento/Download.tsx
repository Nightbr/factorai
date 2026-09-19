import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './bento.module.css';

/**
 * The download band (roadmap item 58): one primary button for the platform the
 * browser reports, the others behind a dialog with the detected one on top.
 * Asset names carry the version (`factorai_0.45.0_universal.dmg`), so exact
 * links come from one call to the GitHub releases API when the dialog opens;
 * if that fails, every link falls back to the releases page, which cannot be
 * stale. No invented evidence: the version, date and sizes shown are the
 * API's.
 */
const REPO = 'Nightbr/factorai';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

type Platform = 'mac' | 'linux' | 'windows';

const PLATFORMS: Record<
	Platform,
	{ name: string; button: string; detail: string; match: (n: string) => boolean }
> = {
	mac: {
		name: 'macOS',
		button: 'Download for macOS',
		detail: 'Universal .dmg, Apple Silicon and Intel',
		match: (n) => n.endsWith('.dmg'),
	},
	linux: {
		name: 'Linux',
		button: 'Download for Linux',
		detail: '.AppImage, x86-64',
		match: (n) => n.endsWith('.AppImage'),
	},
	windows: {
		name: 'Windows',
		button: 'Download for Windows',
		detail: 'Installer that runs the Linux build inside WSL 2',
		match: (n) => n.endsWith('.exe'),
	},
};

interface Release {
	tag: string;
	date: string;
	assets: { name: string; url: string; size: number }[];
}

function detect(): Platform {
	if (typeof navigator === 'undefined') return 'mac';
	const ua = navigator.userAgent;
	if (/Windows/i.test(ua)) return 'windows';
	if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
	return 'mac';
}

function mb(bytes: number): string {
	if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / 1048576).toFixed(0)} MB`;
}

function ago(iso: string): string {
	const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 30) return `${days} days ago`;
	return new Date(iso).toLocaleDateString('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

export function Download() {
	const [platform, setPlatform] = useState<Platform>('mac');
	const [release, setRelease] = useState<Release | null | 'failed'>(null);
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		setPlatform(detect());
	}, []);

	const load = useCallback(async () => {
		if (release) return;
		try {
			const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
				headers: { Accept: 'application/vnd.github+json' },
			});
			if (!res.ok) throw new Error(String(res.status));
			const json = (await res.json()) as {
				tag_name: string;
				published_at: string;
				assets: { name: string; browser_download_url: string; size: number }[];
			};
			setRelease({
				tag: json.tag_name,
				date: json.published_at,
				assets: json.assets.map((a) => ({
					name: a.name,
					url: a.browser_download_url,
					size: a.size,
				})),
			});
		} catch {
			setRelease('failed');
		}
	}, [release]);

	// The primary button wants the exact asset too; fetch on first sight.
	useEffect(() => {
		load();
	}, [load]);

	const assetFor = (p: Platform) =>
		release && release !== 'failed' ? release.assets.find((a) => PLATFORMS[p].match(a.name)) : null;

	const primary = assetFor(platform);
	const order: Platform[] = [
		platform,
		...(['mac', 'linux', 'windows'] as Platform[]).filter((p) => p !== platform),
	];

	return (
		<section className={styles.download} id="download">
			<span className={styles.eyebrow}>get it</span>
			<h2 className={styles.heading}>Forge your own.</h2>
			<div className={styles.ctaRow}>
				<a className={styles.cta} href={primary?.url ?? RELEASES}>
					{PLATFORMS[platform].button}
				</a>
				<button
					type="button"
					className={styles.ctaSecondary}
					onClick={() => dialog.current?.showModal()}
				>
					Other platforms
				</button>
			</div>
			<p className={styles.ctaDetail}>
				{PLATFORMS[platform].detail}
				{primary ? ` · ${mb(primary.size)}` : ''}
				{release && release !== 'failed' ? ` · ${release.tag}, ${ago(release.date)}` : ''}
				{' · '}updates itself · needs the{' '}
				<a href="https://claude.com/claude-code">Claude Code CLI</a>
			</p>

			<dialog ref={dialog} className={styles.dialog} aria-label="Choose a platform">
				<div className={styles.dialogHead}>
					<span className={styles.eyebrow}>
						{release && release !== 'failed'
							? `${release.tag} · ${ago(release.date)}`
							: 'latest release'}
					</span>
					<button
						type="button"
						className={styles.close}
						onClick={() => dialog.current?.close()}
						aria-label="Close"
					>
						×
					</button>
				</div>
				<ul className={styles.platforms}>
					{order.map((p, i) => {
						const asset = assetFor(p);
						return (
							<li key={p} data-detected={i === 0 ? '' : undefined}>
								<a href={asset?.url ?? RELEASES}>
									<span className={styles.platformName}>
										{PLATFORMS[p].name}
										{i === 0 && <small>detected</small>}
									</span>
									<span className={styles.platformDetail}>{PLATFORMS[p].detail}</span>
									<span className={styles.platformAsset}>
										{asset ? `${asset.name} · ${mb(asset.size)}` : 'on the releases page'}
									</span>
								</a>
							</li>
						);
					})}
				</ul>
				<p className={styles.dialogFoot}>
					{release === 'failed'
						? 'Could not reach GitHub for the asset list; the links open the releases page.'
						: 'Every build updates itself. Windows runs the Linux build inside WSL 2.'}{' '}
					<a href={RELEASES}>All releases</a>
				</p>
			</dialog>
		</section>
	);
}
