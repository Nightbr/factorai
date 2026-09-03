import { IconButton } from '@factorai/ui';
import { X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { PanelResizer } from '@components/layout/PanelResizer';
import {
	attachStream,
	disposeTerminal,
	fitToHost,
	getOrCreateTerm,
	type PooledTerm,
	showOnly,
} from '@components/terminal/Terminal';
import { closePane } from '@components/terminal/shells';
import {
	availableWidth,
	clampPaneWidth,
	MIN_PANE_WIDTH,
	paneFractions,
	resizePair,
} from '@lib/shellLayout';
import { cmd } from '@lib/tauri';
import { type ShellPaneTab, type ShellTab, useShellStore } from '@store/shellStore';

/**
 * The active chip's panes, side by side (`specs/05-features.md` § F23, F24).
 *
 * One pooled xterm per pane, each in its own host, with a `PanelResizer`
 * between neighbours. Widths are fractions from the store — equal unless
 * somebody dragged — drawn as `flex-grow`, so the browser does the division and
 * this component only converts a drag's pixels back into fractions.
 *
 * Switching chips unmounts this row, which detaches every pane's host; F23
 * already accepts that for the collapse, and the hosts come back into their
 * boxes and are measured again when the chip returns. **Navigating between
 * sessions does not**, since ADR-0032 put the footer in the app shell: the row
 * is the project's, so it is the same element and the same hosts.
 */
export function ShellPane({ projectId }: { projectId: string }) {
	const activeKey = useShellStore((s) => s.activeByProject[projectId] ?? null);
	const chip = useShellStore((s) => s.byProject[projectId]?.find((c) => c.key === activeKey));
	if (!chip) return null;
	return <PaneRow chip={chip} />;
}

/**
 * The row itself, mounted only while a chip is active so its width can be
 * measured once on mount and then watched. A chip switch keeps this element —
 * the row is the same box whichever chip fills it — so the observer survives.
 */
function PaneRow({ chip }: { chip: ShellTab }) {
	const rowRef = useRef<HTMLDivElement>(null);
	const [rowWidth, setRowWidth] = useState(0);
	const dragged = useShellStore((s) => s.widthsByChip[chip.key]);
	const setWidths = useShellStore((s) => s.setWidths);
	const equalize = useShellStore((s) => s.equalize);

	// The row's width is what a drag's pixels are a fraction of. Measured here
	// rather than passed down: the row is the only thing that knows it.
	useEffect(() => {
		const row = rowRef.current;
		if (!row) return;
		setRowWidth(row.clientWidth);
		const ro = new ResizeObserver(() => setRowWidth(row.clientWidth));
		ro.observe(row);
		return () => ro.disconnect();
	}, []);

	const count = chip.panes.length;
	const fractions = paneFractions(dragged, count);
	const available = availableWidth(rowWidth, count);

	return (
		<div className="h-full w-full overflow-hidden border-border border-t bg-[#0c0e12]">
			<div ref={rowRef} className="flex h-full w-full" data-testid="shell-pane">
				{chip.panes.map((pane, i) => (
					<Fragment key={pane.key}>
						{i > 0 && (
							<PanelResizer
								// The divider is the right edge of the pane before it: a drag to
								// the right widens that pane and the one after it gives the
								// width up, which is what `resizePair` does.
								size={fractions[i - 1] * available}
								onSize={(px) => setWidths(chip.key, resizePair(fractions, i - 1, px, rowWidth))}
								edge="right"
								label={`Resize pane ${i}`}
								clamp={(px) => clampPaneWidth(fractions, i - 1, px, rowWidth)}
								onReset={() => equalize(chip.key)}
							/>
						)}
						<PaneHost
							projectId={chip.projectId}
							chipKey={chip.key}
							pane={pane}
							focused={chip.focus === pane.key}
							closable={count > 1}
							fraction={fractions[i]}
						/>
					</Fragment>
				))}
			</div>
		</div>
	);
}

/**
 * The PTY this pane is on, spawning one only if it has none.
 *
 * **The reuse branch is what a renderer reload needs** (ADR-0032). A reload
 * empties the xterm pool while every PTY carries on, so `attachStream` arrives
 * here with `ptyAttached` false on a pane whose shell is still running — and
 * spawning then would leave the first one alive and unreachable. `adoptLive`
 * has already put its id back on the pane by the time a chip can be clicked,
 * and this returns it instead. The same shape as `ensureTerminal` for an agent,
 * and for the same reason.
 *
 * A **dead** pane has no id, so it spawns: that is the click on a dead chip.
 */
function ensureShell(
	projectId: string,
	paneKey: string,
	cwd: string,
	cols: number,
	rows: number,
): Promise<string> {
	const existing = useShellStore
		.getState()
		.byProject[projectId]?.flatMap((c) => c.panes)
		.find((p) => p.key === paneKey)?.terminalId;
	if (existing) return Promise.resolve(existing);
	// `clientKey` is this pane's own key, round-tripped by Rust so the next
	// reload can find this PTY through `terminal_list`.
	return cmd.shellSpawn({ clientKey: paneKey, projectId, cwd, cols, rows }).then((id) => {
		useShellStore.getState().attach(paneKey, id);
		return id;
	});
}

/**
 * One pane: a pooled xterm in a box the row sizes.
 *
 * The lifecycle is F23's for a chip, per pane: adopt or create the pooled
 * terminal, measure it before the spawn so the shell is born at the real
 * width, spawn if it has no PTY, and — for a **dead** pane that has just come
 * back on screen — throw the finished terminal away first so it spawns again.
 */
function PaneHost({
	projectId,
	chipKey,
	pane,
	focused,
	closable,
	fraction,
}: {
	projectId: string;
	chipKey: string;
	pane: ShellPaneTab;
	focused: boolean;
	/** Only a pane with neighbours draws its own `×`; alone, the chip's is the
	 *  close and a second one would be the same control twice (F24). */
	closable: boolean;
	fraction: number;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const entryRef = useRef<PooledTerm | null>(null);
	/** This pane's dead terminal has already been thrown away — see below. */
	const respawning = useRef(false);
	const setFocus = useShellStore((s) => s.setFocus);
	// **Primitives, never the pane object.** The store hands out a new object
	// when anything on the pane changes, and an effect keyed on identity would
	// tear down and re-run on an `attach`.
	const { key, cwd, dead } = pane;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// A dead pane whose chip has just been clicked: throw the finished
		// terminal away so `attachStream` will spawn again. Its scrollback goes
		// with it, which is right — the shell it belonged to is gone, and a prompt
		// that answers nothing is worse than an empty pane.
		//
		// **Once per death, tracked in a ref**, because this effect re-runs while
		// `dead` is still true: StrictMode invokes it twice on mount. Disposing on
		// the second run would throw away the terminal whose `shell_spawn` is
		// still in flight, and the resolved spawn would then write into a
		// disposed xterm.
		if (dead && !respawning.current) {
			respawning.current = true;
			disposeTerminal(key);
		} else if (!dead && respawning.current) {
			// Live again: the next death is a new respawn.
			respawning.current = false;
		}

		const entry = getOrCreateTerm(
			key,
			container,
			// Read from the store at call time, not captured: a pane respawned
			// after its process died keeps its key and gets a new PTY (F23).
			() =>
				useShellStore
					.getState()
					.byProject[projectId]?.flatMap((c) => c.panes)
					.find((p) => p.key === key)?.terminalId ?? undefined,
		);
		entryRef.current = entry;
		// True after a collapse or a chip switch: the row unmounted and took its
		// children with it, while the PTY kept running. The host comes back into
		// a box of a different size, so it is measured again below.
		const adopted = entry.host.parentElement !== container;
		if (adopted) container.appendChild(entry.host);
		showOnly(container, entry);
		// Measure before the spawn so the shell is born at the real width — an
		// 80-column default would wrap every `git log` line until the next resize.
		fitToHost(entry);
		// An adopted host was last measured against a box that no longer exists,
		// so its first paint here is at the old grid until something redraws it.
		if (adopted) {
			requestAnimationFrame(() => {
				fitToHost(entry);
				entry.term.refresh(0, entry.term.rows - 1);
			});
		}

		attachStream(
			entry,
			(cols, rows) => ensureShell(projectId, key, cwd, cols, rows),
			'Failed to open a shell',
		);

		const ro = new ResizeObserver(() => fitToHost(entry));
		ro.observe(container);

		return () => {
			ro.disconnect();
			entry.host.style.visibility = 'hidden';
		};
		// `dead` is in the list deliberately: a click on a dead chip has to re-run
		// this effect, and the key alone does not change when it is respawned.
	}, [projectId, key, cwd, dead]);

	// The chip's focused pane takes the caret: on the chip opening, on a split
	// (the new pane is focused), and on a click, where xterm already has it and
	// this is a no-op. After the frame, so the host has its size. Not while the
	// pane is dead: its terminal is the one being thrown away, and the respawn
	// brings this effect back round once there is a live one to focus.
	useEffect(() => {
		if (!focused || dead) return;
		const timer = setTimeout(() => {
			const entry = entryRef.current;
			if (!entry || entry.disposed) return;
			fitToHost(entry);
			entry.term.scrollToBottom();
			entry.term.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, [focused, dead]);

	return (
		<div
			// `group` for the corner `×` and the focus line, both of which read the
			// pane's hover and focus rather than their own.
			className="group relative h-full min-w-0"
			style={{ flex: `${fraction} 1 0px`, minWidth: MIN_PANE_WIDTH }}
			// xterm's textarea takes DOM focus on a click; `focus` bubbles here as
			// `focusin`, and that is how the store learns which pane has the caret.
			onFocus={() => setFocus(chipKey, key)}
			data-testid="shell-pane-host"
		>
			{/* `p-2` and `overflow-hidden` for the reason the agent's pane has them:
			    the 8px is the slack a row's text spills into at a fractional zoom. */}
			<div className="h-full w-full overflow-hidden p-2">
				<div ref={containerRef} className="relative h-full w-full" />
			</div>
			{/* **Focus is a 1px amber line on the pane's top edge**, only while a
			    shell in this pane has DOM focus (F24). Amber because this is the
			    focus ring, one of the four uses `DESIGN.md` grants it — and absent
			    when the agent has the caret, so the row says nothing then. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary opacity-0 group-focus-within:opacity-100"
			/>
			{closable && (
				// The backing is a box behind the control, not a state of the
				// control: `DESIGN.md` paints nothing behind an icon button, and this
				// square is what lets the `×` read over whatever the terminal shows.
				<div className="invisible absolute top-3 right-3 rounded-md border border-border bg-card group-focus-within:visible group-hover:visible">
					<IconButton
						aria-label="Close this shell"
						className="size-6"
						onClick={() => closePane(pane)}
					>
						<X className="size-3" />
					</IconButton>
				</div>
			)}
		</div>
	);
}
