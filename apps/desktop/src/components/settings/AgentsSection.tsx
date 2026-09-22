import type { AgentId, ClaudeCliStatus, SettingKey } from '@factorai/types';
import { Input, SettingRow } from '@factorai/ui';
import { useQueries } from '@tanstack/react-query';
import { Check, ChevronRight, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { AgentMark } from '@components/layout/AgentMark';
import { AGENTS } from '@lib/agents';
import { queryKeys } from '@lib/queryKeys';
import { binaryOverride } from '@lib/settingsDraft';
import { cmd } from '@lib/tauri';

/** One probed path and what came back, so a stale answer can never be shown
 *  against a path you have since edited. */
export interface BinaryProbe {
	/** The trimmed text this answer is about. */
	path: string;
	status: ClaudeCliStatus;
}

/** Which draft field and which SQLite key hold each agent's override — one of
 *  each per agent, mirroring one `SettingKey` variant per agent in Rust (F30). */
export const BINARY_KEY: Record<AgentId, 'claudeBinary' | 'codexBinary'> = {
	claude: 'claudeBinary',
	codex: 'codexBinary',
};
export const SETTING_KEY: Record<AgentId, SettingKey> = {
	claude: 'claudeBinaryPath',
	codex: 'codexBinaryPath',
};

interface AgentsSectionProps {
	/** Each override field's text, verbatim — the parent's draft owns it. */
	values: Record<AgentId, string>;
	onChange: (agent: AgentId, next: string) => void;
	/** The last probe per agent, or null when nothing has been checked. Held by
	 *  the parent because Save consults it: a path known to be bad disables the
	 *  button. */
	probes: Partial<Record<AgentId, BinaryProbe | null>>;
	onProbed: (agent: AgentId, probe: BinaryProbe | null) => void;
}

/**
 * Which agents this machine has, and the overrides that pin them (F11, F30).
 *
 * One card per agent in the registry, each the Claude section as it was —
 * the read-only detected row reports the **effective** binary, override
 * included, so this page and the spawn path can never name different ones.
 * **Only the binaries.** Which agent a project runs is a property of its
 * profile (ADR-0061), so that choice lives in the Profiles section and the
 * project menu, not here.
 */
export function AgentsSection({ values, onChange, probes, onProbed }: AgentsSectionProps) {
	const detected = useQueries({
		queries: AGENTS.map(({ id }) => ({
			queryKey: queryKeys.agentCli(id),
			queryFn: () => cmd.checkAgentCli(id),
			// A shell probe and a `--version` spawn; not something to repeat while
			// somebody reads the row.
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
		})),
	});

	return (
		<div className="space-y-2">
			{AGENTS.map(({ id, name, binary }, i) => (
				<AgentCard
					key={id}
					agent={id}
					name={name}
					binary={binary}
					detected={detected[i]?.data}
					pending={detected[i]?.isPending ?? true}
					value={values[id]}
					onChange={(next) => onChange(id, next)}
					probe={probes[id] ?? null}
					onProbed={(probe) => onProbed(id, probe)}
				/>
			))}
		</div>
	);
}

function AgentCard({
	agent,
	name,
	binary,
	detected,
	pending,
	value,
	onChange,
	probe,
	onProbed,
}: {
	agent: AgentId;
	name: string;
	binary: string;
	detected: ClaudeCliStatus | undefined;
	pending: boolean;
	value: string;
	onChange: (next: string) => void;
	probe: BinaryProbe | null;
	onProbed: (probe: BinaryProbe | null) => void;
}) {
	const [checking, setChecking] = useState(false);
	// Open when an override is set: a card hiding the one field somebody edited
	// would read as the setting being gone.
	const [open, setOpen] = useState(() => binaryOverride(value) !== null);

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
			onProbed({ path, status: await cmd.validateAgentBinary(agent, path) });
		} catch {
			// The probe itself failing is indistinguishable from the path being
			// unusable, as far as this field is concerned.
			onProbed({ path, status: { installed: false, binaryPath: null, version: null } });
		} finally {
			setChecking(false);
		}
	}

	const current = binaryOverride(value);
	// Only ever shown for the path in the box, so an edit blanks the feedback
	// rather than leaving an answer about something else on screen.
	const answer = probe && probe.path === current ? probe.status : null;
	const inputId = `settings-${agent}-binary`;

	return (
		<section data-testid={`settings-agent-${agent}`} className="rounded-md border border-border">
			{/* **Collapsed by default.** The header alone answers the question you
			    open this section with — is it here — and the override field is for the
			    one time the probe is wrong. A native button, so the header is
			    focusable and Enter/Space toggle it. */}
			<button
				type="button"
				aria-expanded={open}
				aria-controls={`${inputId}-body`}
				data-testid={`settings-agent-${agent}-toggle`}
				onClick={() => setOpen((v) => !v)}
				className={`flex w-full items-center gap-2 px-3 py-2 text-left ${open ? 'border-b border-border' : ''} ${
					detected?.installed || pending ? '' : 'text-muted-foreground'
				}`}
			>
				<ChevronRight
					className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
					aria-hidden
				/>
				<AgentMark agent={agent} aria-hidden />
				<h3 className="min-w-0 flex-1 truncate text-sm">{name}</h3>
				{!pending && detected?.installed && (
					<span className="font-mono text-muted-foreground text-xs">
						{detected.version ?? 'version unknown'}
					</span>
				)}
				{!pending && (
					<span
						data-testid={`settings-agent-${agent}-badge`}
						className={`rounded px-1 py-px text-xs uppercase tracking-wide ${
							detected?.installed
								? 'bg-status-working/15 text-status-working'
								: 'bg-secondary text-muted-foreground'
						}`}
					>
						{detected?.installed ? 'Active' : 'Not detected'}
					</span>
				)}
			</button>
			<div id={`${inputId}-body`} hidden={!open} className="divide-y divide-border px-3">
				<SettingRow
					label="Detected binary"
					description={
						pending
							? 'Looking…'
							: detected?.installed
								? 'Resolved when a session starts, so running sessions are unaffected.'
								: `No ${binary} binary found. Sessions with ${name} cannot start until there is one.`
					}
					stacked
				>
					{detected?.installed ? (
						<p className="break-all font-mono text-secondary-foreground text-xs">
							{detected.binaryPath}
							{detected.version ? (
								<span className="text-muted-foreground"> · {detected.version}</span>
							) : (
								<span className="text-muted-foreground"> · version unknown</span>
							)}
						</p>
					) : (
						!pending && (
							<p className="flex items-center gap-1.5 text-destructive text-xs">
								<TriangleAlert className="size-3.5 shrink-0" aria-hidden />
								Not found
							</p>
						)
					)}
				</SettingRow>

				<SettingRow
					label="Override path"
					htmlFor={inputId}
					description="Leave empty to keep auto-detecting. A path here is used as-is, for the next session you start."
					stacked
				>
					<Input
						id={inputId}
						data-testid={inputId}
						// **Empty, with the detected path as the placeholder.** Prefilling it
						// would silently turn auto-detection into a pinned path the first
						// time Save was pressed for any unrelated reason — and then the day
						// the binary moves, the app points at a path that no longer exists
						// while the probe that would have found it is being overridden by a
						// value nobody chose. Unset is a real state and it means "keep
						// probing".
						placeholder={detected?.binaryPath ?? `/path/to/${binary}`}
						spellCheck={false}
						autoComplete="off"
						className="font-mono text-xs"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						onBlur={() => void probeOnBlur()}
					/>
					{checking && <p className="text-muted-foreground text-xs">Checking…</p>}
					{!checking && answer && !answer.installed && (
						<p data-testid={`${inputId}-error`} className="text-destructive text-xs">
							Nothing runnable at that path.
						</p>
					)}
					{!checking && answer?.installed && (
						<p className="flex items-center gap-1.5 text-primary text-xs">
							<Check className="size-3.5 shrink-0" aria-hidden />
							{answer.version ? `${binary} ${answer.version}` : 'Found, but it reported no version'}
						</p>
					)}
				</SettingRow>
			</div>
		</section>
	);
}
