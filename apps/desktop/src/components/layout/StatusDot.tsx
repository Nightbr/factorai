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

/** Small coloured dot for a session's PTY status. Pulses while running. */
export function StatusDot({ status, className }: { status: TerminalStatus; className?: string }) {
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
				status === 'running' && 'animate-running-pulse',
				className,
			)}
		/>
	);
}
