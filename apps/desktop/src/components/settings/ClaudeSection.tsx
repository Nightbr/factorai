import type { ClaudeCliStatus } from '@factorai/types';
import { Input, SettingRow } from '@factorai/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { binaryOverride } from '@lib/settingsDraft';
import { queryKeys } from '@lib/queryKeys';
import { cmd } from '@lib/tauri';

/** One probed path and what came back, so a stale answer can never be shown
 *  against a path you have since edited. */
export interface BinaryProbe {
	/** The trimmed text this answer is about. */
	path: string;
	status: ClaudeCliStatus;
}

interface ClaudeSectionProps {
	/** The override field's text, verbatim — the parent's draft owns it. */
	value: string;
	onChange: (next: string) => void;
	/** The last probe, or null when nothing has been checked. Held by the parent
	 *  because Save consults it: a path known to be bad disables the button. */
	probe: BinaryProbe | null;
	onProbed: (probe: BinaryProbe | null) => void;
}

/**
 * Which `claude` the app runs, and the override that pins it (F11).
 *
 * The read-only row is the first consumer `check_claude_cli` has ever had — it
 * has been on the bridge since M0 with no callers — and it reports the
 * **effective** binary, override included, so this page and the spawn path can
 * never name different ones.
 */
export function ClaudeSection({ value, onChange, probe, onProbed }: ClaudeSectionProps) {
	const [checking, setChecking] = useState(false);

	const detected = useQuery({
		queryKey: queryKeys.claudeCli(),
		queryFn: () => cmd.checkClaudeCli(),
		// A shell probe and a `--version` spawn; not something to repeat while
		// somebody reads the row.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	async function probeOnBlur() {
		const path = binaryOverride(value);
		// Nothing to check: an empty field means "keep probing", which is a valid
		// state and not a path that can fail.
		if (!path) {
			onProbed(null);
			return;
		}
		if (probe?.path === path) return;
		setChecking(true);
		try {
			onProbed({ path, status: await cmd.validateClaudeBinary(path) });
		} catch {
			// The probe itself failing is indistinguishable from the path being
			// unusable, as far as this field is concerned.
			onProbed({ path, status: { installed: false, binaryPath: null, version: null } });
		} finally {
			setChecking(false);
		}
	}

	const status = detected.data;
	const current = binaryOverride(value);
	// Only ever shown for the path in the box, so an edit blanks the feedback
	// rather than leaving an answer about something else on screen.
	const answer = probe && probe.path === current ? probe.status : null;

	return (
		<div className="divide-y divide-border">
			<SettingRow
				label="Detected binary"
				description={
					detected.isPending
						? 'Looking…'
						: status?.installed
							? 'Resolved when a session starts, so running sessions are unaffected.'
							: 'No claude binary found. New sessions cannot start until there is one.'
				}
				stacked
			>
				{status?.installed ? (
					<p className="break-all font-mono text-secondary-foreground text-xs">
						{status.binaryPath}
						{status.version ? (
							<span className="text-muted-foreground"> · {status.version}</span>
						) : (
							<span className="text-muted-foreground"> · version unknown</span>
						)}
					</p>
				) : (
					!detected.isPending && (
						<p className="flex items-center gap-1.5 text-destructive text-xs">
							<TriangleAlert className="size-3.5 shrink-0" aria-hidden />
							Not found
						</p>
					)
				)}
			</SettingRow>

			<SettingRow
				label="Override path"
				htmlFor="settings-claude-binary"
				description="Leave empty to keep auto-detecting. A path here is used as-is, for the next session you start."
				stacked
			>
				<Input
					id="settings-claude-binary"
					data-testid="settings-claude-binary"
					// **Empty, with the detected path as the placeholder.** Prefilling it
					// would silently turn auto-detection into a pinned path the first
					// time Save was pressed for any unrelated reason — and then the day
					// claude moves, the app points at a path that no longer exists while
					// the probe that would have found it is being overridden by a value
					// nobody chose. Unset is a real state and it means "keep probing".
					placeholder={status?.binaryPath ?? '/path/to/claude'}
					spellCheck={false}
					autoComplete="off"
					className="font-mono text-xs"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onBlur={() => void probeOnBlur()}
				/>
				{checking && <p className="text-muted-foreground text-xs">Checking…</p>}
				{!checking && answer && !answer.installed && (
					<p data-testid="settings-claude-binary-error" className="text-destructive text-xs">
						Nothing runnable at that path.
					</p>
				)}
				{!checking && answer?.installed && (
					<p className="flex items-center gap-1.5 text-primary text-xs">
						<Check className="size-3.5 shrink-0" aria-hidden />
						{answer.version ? `claude ${answer.version}` : 'Found, but it reported no version'}
					</p>
				)}
			</SettingRow>
		</div>
	);
}
