import { SettingRow } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { BrandIcon, BrandWordmark } from '@components/brand/Brand';
import { requestRestart } from '@components/layout/RestartConfirm';
import { updateLabel, useUpdater } from '@hooks/useUpdater';
import { buildLine, displayVersion, fetchBuildInfo, formatBuildDate } from '@lib/buildInfo';
import { needsQuitConfirm } from '@lib/quitConfirm';
import { queryKeys } from '@lib/queryKeys';
import { copyText, openExternally } from '@lib/tauri';
import { useTerminalStore } from '@store/terminalStore';

/** The repository, which is where every link in this section goes. One
 *  constant, because three of them are the same URL with a suffix. */
const REPO = 'https://github.com/Nightbr/factorai';

/**
 * About: the mark, the name, the build, the licence and the people in it
 * (specs/05-features.md F29).
 *
 * **The section that sets nothing.** Like Profiles it takes no draft and gives
 * none back, so it can never be dirty and never carries a nav dot — which is
 * also why it is last: a table of contents puts the page that changes nothing at
 * the bottom.
 *
 * Everything on screen comes from the bundle: `build-info.json` for the release
 * facts (ADR-0049), the brand component for the mark, and `updaterStore` for the
 * one row that is a control. Nothing here talks to the network, and a machine
 * with no network shows the same pane as one with.
 */
export function AboutSection() {
	const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
	const [showContributors, setShowContributors] = useState(false);
	const { state, checkNow } = useUpdater();
	const live = useTerminalStore((s) => Object.keys(s.bySession).length);
	const working = useTerminalStore(
		(s) => Object.values(s.bySession).filter((t) => t.status === 'working').length,
	);

	// Fetched rather than imported, and `null` rather than an error: a build
	// without this file is a build nobody released, which is every build on a
	// developer's machine (ADR-0049). `staleTime: Infinity` because a file inside
	// the bundle cannot change while the app is running.
	const buildInfo = useQuery({
		queryKey: queryKeys.buildInfo(),
		queryFn: fetchBuildInfo,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const info = buildInfo.data ?? null;
	// Until the fetch settles, the version is unknown rather than the define's:
	// showing the dev string for a frame and then correcting it to the release
	// would be the pane misreporting the one fact it exists to report.
	const pending = buildInfo.isPending;

	async function copyBuildLine() {
		try {
			await copyText(buildLine(info));
			setCopied('yes');
		} catch {
			// A clipboard write can be refused by the platform, and an unhandled
			// rejection here is the crash overlay over the settings modal.
			setCopied('failed');
		}
		window.setTimeout(() => setCopied(null), 1600);
	}

	return (
		<div className="pb-2">
			{/* The centred block is Empty Hero's shape and its `text-lg` step, which
			    `DESIGN.md` documents as the exception to the two type sizes — no
			    third size is invented here. The mark is the full-colour one because
			    this is where somebody looks to see the icon their dock shows
			    (`09-branding.md` B8). */}
			<div className="flex flex-col items-center gap-2 px-4 pt-2 pb-5 text-center">
				<BrandIcon />
				<BrandWordmark className="text-lg" />
				{/* The README's hook, then B10's tagline under it. Both, in that
				    order, and this is the one surface where both appear: the hook is
				    for a human reading a panel, the tagline is the sentence that says
				    plainly what the program is. */}
				<p className="text-sm">IDE is dead. Long live the ADE.</p>
				<p className="text-muted-foreground text-xs">
					Agentic Development Environment (ADE) for the AI era
				</p>
			</div>

			<div className="divide-y divide-border border-border border-t">
				<SettingRow label="Version" description="Click to copy the build line for a bug report.">
					<button
						type="button"
						data-testid="settings-about-version"
						className="flex items-center gap-2 text-sm transition-colors hover:text-foreground"
						onClick={copyBuildLine}
					>
						<span>{pending ? '…' : displayVersion(info)}</span>
						{copied && (
							<span className="text-primary text-xs">
								{copied === 'yes' ? 'Copied' : 'Copy failed'}
							</span>
						)}
					</button>
				</SettingRow>

				<SettingRow
					label="Build"
					description={
						info
							? 'Written by the release workflow into the bundle.'
							: 'Release metadata is written by CI, so a local build has none.'
					}
				>
					<span data-testid="settings-about-build" className="text-sm">
						{pending ? (
							'…'
						) : info ? (
							<>
								{info.commit && <span className="font-mono text-xs">{info.commit} · </span>}
								{formatBuildDate(info.builtAt)}
							</>
						) : (
							<span className="text-muted-foreground">Built locally</span>
						)}
					</span>
				</SettingRow>

				<SettingRow label="Licence" description="© 2026 Titouan BENOIT and contributors.">
					<button
						type="button"
						className="text-sm transition-colors hover:text-primary"
						onClick={() => void openExternally(`${REPO}/blob/main/LICENSE`)}
					>
						MIT licence
					</button>
				</SettingRow>

				{/* Only ever rendered for a release build with names in it. A row
				    saying "0 contributors" about a repository with a git history
				    reads as a bug in the pane rather than as a fact about the build. */}
				{info && info.contributors.length > 0 && (
					<div>
						<SettingRow
							label="Contributors"
							description="Everyone with a commit in the release this build came from."
						>
							<button
								type="button"
								data-testid="settings-about-contributors"
								aria-expanded={showContributors}
								className="flex items-center gap-1 text-sm transition-colors hover:text-foreground"
								onClick={() => setShowContributors((open) => !open)}
							>
								{info.contributors.length} contributors
								<ChevronRight
									className={`size-3.5 transition-transform ${showContributors ? 'rotate-90' : ''}`}
								/>
							</button>
						</SettingRow>
						{showContributors && (
							// In place rather than a link to the graphs page: the list is
							// already in the bundle, so sending someone to a browser to
							// read what the app is holding would be a strange trade.
							<div
								data-testid="settings-about-contributor-list"
								className="flex flex-wrap gap-x-3 gap-y-1 pb-3"
							>
								{info.contributors.map((person) => (
									<button
										key={person.login}
										type="button"
										className="font-mono text-muted-foreground text-xs transition-colors hover:text-primary"
										onClick={() => void openExternally(person.url)}
									>
										{person.login}
									</button>
								))}
							</div>
						)}
					</div>
				)}

				<SettingRow label="Repository" description="github.com/Nightbr/factorai">
					<button
						type="button"
						className="text-sm transition-colors hover:text-primary"
						onClick={() => void openExternally(REPO)}
					>
						Open on GitHub
					</button>
				</SettingRow>

				<SettingRow
					label="Updates"
					description="Checked on launch and every six hours. The sidebar footer shows the same state."
				>
					{/* The same updater as the footer badge, not a second one: the phase
					    lives in `updaterStore` and this row subscribes (ADR-0050). */}
					{import.meta.env.DEV ? (
						// The updater never runs against an unpackaged binary (F14), so a
						// button here would be a control structurally incapable of finding
						// anything.
						<span className="text-muted-foreground text-sm">Off in a dev build</span>
					) : state.phase === 'ready' ? (
						<button
							type="button"
							data-testid="settings-about-restart"
							className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary text-sm transition-colors hover:bg-primary/20"
							onClick={() => requestRestart(needsQuitConfirm({ live, working }))}
						>
							<RefreshCw className="size-3.5" />
							Update ready — restart
						</button>
					) : (
						<button
							type="button"
							data-testid="settings-about-check"
							className="text-sm transition-colors hover:text-foreground disabled:text-muted-foreground"
							disabled={state.phase === 'checking' || state.phase === 'downloading'}
							onClick={checkNow}
						>
							{updateLabel(state.phase)}
						</button>
					)}
				</SettingRow>
			</div>
		</div>
	);
}
