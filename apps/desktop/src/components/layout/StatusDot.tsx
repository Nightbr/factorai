import type { TerminalStatus } from '@factorai/types';
import { cn } from '@factorai/ui';

const COLOR: Record<TerminalStatus, string> = {
	working: 'bg-status-working',
	waiting_input: 'bg-status-waiting',
	stopped: 'bg-status-stopped',
};

const LABEL: Record<TerminalStatus, string> = {
	working: 'Working',
	waiting_input: 'Waiting for input',
	stopped: 'Stopped',
};

/**
 * Small coloured dot for a session's PTY status.
 *
 * **Still by default.** The pulse is opt-in because the app now shows this dot
 * in several places at once — sidebar projects, sidebar sessions, tabs — and a
 * dozen things breathing at their own rate is a christmas tree, not a signal.
 * It earns the animation in the session header, where there is exactly one and
 * it describes what you are looking at.
 */
export function StatusDot({
	status,
	className,
	pulse = false,
	background = false,
}: {
	status: TerminalStatus;
	className?: string;
	pulse?: boolean;
	/** The session is running with **no tab** — a routine's, until somebody
	 *  opens it (F22).
	 *
	 *  A modifier on `working`, not a fourth status: where a session runs is
	 *  orthogonal to what it is doing, and `waiting_input` keeps its amber
	 *  wherever it runs, because "your move" is true either way. */
	background?: boolean;
}) {
	const inBackground = background && status === 'working';
	return (
		<span
			title={inBackground ? 'Working in the background — no tab open' : LABEL[status]}
			// `cn` (tailwind-merge), not string concatenation: a caller passing
			// `size-1.5` has to actually beat the `size-2` below, and two classes of
			// equal specificity are resolved by stylesheet order, not by which one
			// the caller wrote last.
			className={cn(
				'inline-block size-2 shrink-0 rounded-full',
				inBackground ? 'bg-status-background' : COLOR[status],
				pulse && status === 'working' && 'animate-running-pulse',
				className,
			)}
		/>
	);
}
