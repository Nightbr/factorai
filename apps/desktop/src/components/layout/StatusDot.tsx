import type { TerminalStatus } from '@factorai/types';
import { cn } from '@factorai/ui';

const COLOR: Record<TerminalStatus, string> = {
	running: 'bg-status-running',
	idle: 'bg-status-idle',
	waiting_input: 'bg-status-waiting',
	stopped: 'bg-status-stopped',
};

const LABEL: Record<TerminalStatus, string> = {
	running: 'Running',
	idle: 'Idle',
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
}: {
	status: TerminalStatus;
	className?: string;
	pulse?: boolean;
}) {
	return (
		<span
			title={LABEL[status]}
			// `cn` (tailwind-merge), not string concatenation: a caller passing
			// `size-1.5` has to actually beat the `size-2` below, and two classes of
			// equal specificity are resolved by stylesheet order, not by which one
			// the caller wrote last.
			className={cn(
				'inline-block size-2 shrink-0 rounded-full',
				COLOR[status],
				pulse && status === 'running' && 'animate-running-pulse',
				className,
			)}
		/>
	);
}
