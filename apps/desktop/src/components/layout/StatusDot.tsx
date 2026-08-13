import type { TerminalStatus } from '@factorai/types';

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
			className={`inline-block size-2 shrink-0 rounded-full ${COLOR[status]} ${
				status === 'running' ? 'animate-running-pulse' : ''
			} ${className ?? ''}`}
		/>
	);
}
