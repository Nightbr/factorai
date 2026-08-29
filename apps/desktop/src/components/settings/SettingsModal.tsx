import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	IconButton,
	Input,
	SettingRow,
	Switch,
} from '@factorai/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { type BinaryProbe, ClaudeSection } from '@components/settings/ClaudeSection';
import { formatError } from '@lib/errors';
import { queryKeys } from '@lib/queryKeys';
import {
	binaryOverride,
	dirtySections,
	SETTINGS_SECTIONS,
	CATCHUP,
	CONCURRENT,
	type SettingsSection,
	type SettingsValues,
} from '@lib/settingsDraft';
import { cmd } from '@lib/tauri';
import { currentPrefs, type Prefs, usePrefsStore } from '@store/prefsStore';

const SECTION_LABELS: Record<SettingsSection, string> = {
	claude: 'Claude',
	editor: 'Editor',
	confirmations: 'Confirmations',
	sessions: 'Sessions',
	routines: 'Routines',
};

interface SettingsModalProps {
	/** Which section is showing, or null for closed. Driven by `?settings=`. */
	section: SettingsSection | null;
	onSection: (section: SettingsSection) => void;
	onClose: () => void;
}

/**
 * The settings surface (specs/05-features.md F11, Q24).
 *
 * A **medium modal driven by the URL**: the session stays visible behind it,
 * Esc dismisses it, and `?settings=` gives deep links, reload survival and
 * browser-back-closes. Nav in a left column rather than a tab strip, because
 * Appearance and Advanced arrive later and a table of contents grows downwards
 * where a horizontal strip reflows.
 *
 * Split in two on purpose: this component is the shell, and the draft it edits
 * lives in `SettingsForm` below, which mounts only once the saved values are in
 * hand. So "cancel discards" is unmounting rather than a reset somebody has to
 * remember to write, and there is no frame in which the form shows defaults it
 * would then correct.
 */
export function SettingsModal({ section, onSection, onClose }: SettingsModalProps) {
	// Read during an event Radix owns, written by the form as it renders. A ref
	// rather than state: nothing on screen depends on it, and making it state
	// would re-render the shell on every keystroke in the form below it.
	const dirtyRef = useRef(false);

	// The one saved value that is not in `prefsStore`: Rust reads it, so it lives
	// in SQLite and arrives asynchronously (ADR-0013).
	// The saved values that are not in `prefsStore`: Rust reads them, so they
	// live in SQLite and arrive asynchronously (ADR-0013). One query for the
	// three of them, because the form mounts only once they are all in hand and
	// three pending states would be three ways to show a default first.
	const sqlite = useQuery({
		queryKey: queryKeys.setting('claudeBinaryPath'),
		queryFn: async () => ({
			claudeBinary: (await cmd.getSetting('claudeBinaryPath')) ?? '',
			routinesCatchupHours: (await cmd.getSetting('routinesCatchupHours')) ?? '',
			routinesMaxConcurrent: (await cmd.getSetting('routinesMaxConcurrent')) ?? '',
		}),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
		enabled: section !== null,
	});

	if (!section) return null;

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				data-testid="settings-modal"
				hideClose
				className="flex h-[26rem] w-[42rem] max-w-[92vw] flex-col gap-0 overflow-hidden p-0"
				// **Click-outside does nothing while dirty.** It is the one dismissal
				// you trigger by accident, reaching for the terminal behind the modal —
				// unlike Esc and Cancel, which are deliberate and discard in silence.
				// The guard lives here rather than in the form because Radix asks the
				// content, so the form reports its dirty state up through a ref-free
				// piece of state.
				onPointerDownOutside={(e) => {
					if (dirtyRef.current) e.preventDefault();
				}}
				onInteractOutside={(e) => {
					if (dirtyRef.current) e.preventDefault();
				}}
			>
				<header className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2.5">
					<DialogTitle className="flex-1 font-medium text-sm">Settings</DialogTitle>
					<IconButton size="md" aria-label="Close settings" title="Close" onClick={onClose}>
						<X />
					</IconButton>
				</header>

				{sqlite.isPending ? (
					<p className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
						Loading…
					</p>
				) : (
					<SettingsForm
						section={section}
						onSection={onSection}
						onClose={onClose}
						savedSqlite={
							sqlite.data ?? {
								claudeBinary: '',
								routinesCatchupHours: '',
								routinesMaxConcurrent: '',
							}
						}
						dirtyRef={dirtyRef}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

interface SettingsFormProps {
	section: SettingsSection;
	onSection: (section: SettingsSection) => void;
	onClose: () => void;
	savedSqlite: Pick<
		SettingsValues,
		'claudeBinary' | 'routinesCatchupHours' | 'routinesMaxConcurrent'
	>;
	/** Where the shell reads "is there an edit" from, for its click-outside
	 *  guard. The form is the only thing that knows. */
	dirtyRef: RefObject<boolean>;
}

function SettingsForm({ section, onSection, onClose, savedSqlite, dirtyRef }: SettingsFormProps) {
	// Snapshotted once, on mount: this is what Cancel returns to and what the
	// dirty dots are measured against. A preference changed behind the modal —
	// the diff footer's own inline toggle is the only one that can — is picked up
	// next time it opens rather than moving under an open draft.
	const [saved] = useState<SettingsValues>(() => ({ ...currentPrefs(), ...savedSqlite }));
	const [draft, setDraft] = useState<SettingsValues>(saved);
	const [probe, setProbe] = useState<BinaryProbe | null>(null);
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const applyPrefs = usePrefsStore((s) => s.applyPrefs);
	const queryClient = useQueryClient();

	const dirty = dirtySections(saved, draft);
	dirtyRef.current = dirty.length > 0;

	// A path already known to be bad blocks Save with the reason beside it: the
	// point of validating before you depend on something is not writing it. A
	// path nobody has blurred yet is *unknown* rather than bad, so Save checks it
	// itself below instead of greying out over something you cannot see.
	const knownBad =
		probe && !probe.status.installed && probe.path === binaryOverride(draft.claudeBinary);
	const canSave = dirty.length > 0 && !knownBad && !saving;

	function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
		setFailure(null);
		setDraft((prev) => ({ ...prev, [key]: value }));
	}

	async function save() {
		setSaving(true);
		setFailure(null);
		try {
			const path = binaryOverride(draft.claudeBinary);
			// Validate a path that has never been blurred — clicking Save straight
			// after typing must not write a path we have not checked.
			if (path && path !== binaryOverride(saved.claudeBinary)) {
				const status = probe?.path === path ? probe.status : await cmd.validateClaudeBinary(path);
				setProbe({ path, status });
				if (!status.installed) {
					setFailure('Nothing runnable at that path.');
					return;
				}
			}
			// **SQLite first.** The fallible store gates the infallible one, so a
			// failed write is a clean no-op with the draft still on screen and the
			// reason attached — rather than a half-apply where the renderer's
			// preferences took and the Rust-readable one didn't, with no way to tell
			// which (F11).
			if (path !== binaryOverride(saved.claudeBinary)) {
				await cmd.setSetting('claudeBinaryPath', path);
				// What `claude` resolves to now depends on it.
				await queryClient.invalidateQueries({ queryKey: queryKeys.claudeCli() });
			}
			// The two the routine runner reads (F22). Written the same way and in
			// the same transaction-shaped order: SQLite first, preferences after.
			const catchup = CATCHUP(draft.routinesCatchupHours);
			if (catchup !== CATCHUP(saved.routinesCatchupHours)) {
				await cmd.setSetting('routinesCatchupHours', catchup);
			}
			const concurrent = CONCURRENT(draft.routinesMaxConcurrent);
			if (concurrent !== CONCURRENT(saved.routinesMaxConcurrent)) {
				await cmd.setSetting('routinesMaxConcurrent', concurrent);
			}
			queryClient.setQueryData(queryKeys.setting('claudeBinaryPath'), {
				claudeBinary: path ?? '',
				routinesCatchupHours: catchup ?? '',
				routinesMaxConcurrent: concurrent ?? '',
			});
			applyPrefs(prefsOf(draft));
			onClose();
		} catch (e) {
			setFailure(formatError(e));
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<div className="flex min-h-0 flex-1">
				<nav
					aria-label="Settings sections"
					className="w-40 shrink-0 space-y-0.5 border-r border-border p-2"
				>
					{SETTINGS_SECTIONS.map((s) => (
						<button
							key={s}
							type="button"
							aria-current={s === section ? 'page' : undefined}
							data-testid={`settings-nav-${s}`}
							className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
								s === section
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							}`}
							onClick={() => onSection(s)}
						>
							<span className="min-w-0 flex-1 truncate">{SECTION_LABELS[s]}</span>
							{/* Which section holds the edit, not merely that one does: with
							    four sections and one Save button, "something is unsaved"
							    without "where" makes you click through the nav to find it. */}
							{dirty.includes(s) && (
								<span
									data-testid={`settings-dirty-${s}`}
									aria-label="unsaved changes"
									className="size-1.5 shrink-0 rounded-full bg-primary"
								/>
							)}
						</button>
					))}
				</nav>

				<div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
					{section === 'claude' && (
						<ClaudeSection
							value={draft.claudeBinary}
							onChange={(next) => set('claudeBinary', next)}
							probe={probe}
							onProbed={setProbe}
						/>
					)}

					{section === 'editor' && (
						<div className="divide-y divide-border">
							<SettingRow
								label="Show diffs inline"
								htmlFor="settings-diff-inline"
								description="Unified rather than side by side. The diff viewer's own toggle sets this too."
							>
								<Switch
									id="settings-diff-inline"
									data-testid="settings-diff-inline"
									checked={draft.diffInline}
									onCheckedChange={(v) => set('diffInline', v)}
								/>
							</SettingRow>
							<SettingRow
								label="Open frontmatter in markdown"
								htmlFor="settings-frontmatter-open"
								description="The fields at the top of a document start expanded. The panel's own chevron still collapses it for that document."
							>
								<Switch
									id="settings-frontmatter-open"
									data-testid="settings-frontmatter-open"
									checked={draft.frontmatterOpen}
									onCheckedChange={(v) => set('frontmatterOpen', v)}
								/>
							</SettingRow>
						</div>
					)}

					{section === 'confirmations' && (
						<div className="divide-y divide-border">
							<SettingRow
								label="Ask before closing a running session"
								htmlFor="settings-confirm-close"
								description="Only while Claude is working — closing an idle session never asks."
							>
								<Switch
									id="settings-confirm-close"
									data-testid="settings-confirm-close"
									checked={draft.confirmCloseSession}
									onCheckedChange={(v) => set('confirmCloseSession', v)}
								/>
							</SettingRow>
							<SettingRow
								label="Ask when a middle-click closes a tab"
								htmlFor="settings-confirm-middle-click"
								description="Its own switch because a wheel-click has no aim to it."
							>
								<Switch
									id="settings-confirm-middle-click"
									data-testid="settings-confirm-middle-click"
									checked={draft.confirmCloseMiddleClick}
									onCheckedChange={(v) => set('confirmCloseMiddleClick', v)}
								/>
							</SettingRow>
							<p className="pt-2.5 text-muted-foreground text-xs">
								Quitting the app always asks. That dialog is about losing every live session at
								once, and it is not optional.
							</p>
						</div>
					)}

					{section === 'routines' && (
						<div className="divide-y divide-border">
							<SettingRow
								label="Run missed routines for up to"
								htmlFor="settings-routines-catchup"
								description="How late a routine may still run when factorai was closed at its scheduled time. Missed runs coalesce into one. A routine can override this, and 0 means never run late."
							>
								<div className="flex items-center gap-1.5">
									<Input
										id="settings-routines-catchup"
										data-testid="settings-routines-catchup"
										className="w-16"
										type="number"
										min={0}
										max={168}
										placeholder="6"
										value={draft.routinesCatchupHours}
										onChange={(e) => set('routinesCatchupHours', e.target.value)}
									/>
									<span className="text-muted-foreground text-xs">hours</span>
								</div>
							</SettingRow>
							<SettingRow
								label="Routine sessions at once"
								htmlFor="settings-routines-concurrent"
								description="Ten projects with an hourly routine all come due at :00. The rest queue in due order and run late — they are not skipped."
							>
								<Input
									id="settings-routines-concurrent"
									data-testid="settings-routines-concurrent"
									className="w-16"
									type="number"
									min={1}
									max={16}
									placeholder="2"
									value={draft.routinesMaxConcurrent}
									onChange={(e) => set('routinesMaxConcurrent', e.target.value)}
								/>
							</SettingRow>
						</div>
					)}

					{section === 'sessions' && (
						<div className="divide-y divide-border">
							<SettingRow
								label="Restore open tabs on launch"
								htmlFor="settings-restore-tabs"
								description="Reopens the session tabs you had. They come back stopped — quitting kills every process."
							>
								<Switch
									id="settings-restore-tabs"
									data-testid="settings-restore-tabs"
									checked={draft.restoreTabs}
									onCheckedChange={(v) => set('restoreTabs', v)}
								/>
							</SettingRow>
						</div>
					)}
				</div>
			</div>

			<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
				{failure && (
					<p data-testid="settings-error" className="mr-auto text-destructive text-xs">
						{failure}
					</p>
				)}
				<Button variant="outline" size="sm" onClick={onClose}>
					Cancel
				</Button>
				{/* Save is the unsaved-changes indicator: disabled until something
				    differs from what is stored. */}
				<Button
					size="sm"
					data-testid="settings-save"
					disabled={!canSave}
					onClick={() => void save()}
				>
					{saving ? 'Saving…' : 'Save'}
				</Button>
			</footer>
		</>
	);
}

/** The draft minus the values that aren't renderer preferences — the three
 *  that live in SQLite because Rust reads them. */
function prefsOf(values: SettingsValues): Prefs {
	const {
		claudeBinary: _binary,
		routinesCatchupHours: _catchup,
		routinesMaxConcurrent: _concurrent,
		...prefs
	} = values;
	return prefs;
}
