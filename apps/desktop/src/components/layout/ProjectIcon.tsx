/**
 * Cheap hashed icon — initials over an HSL color derived from the project
 * path. Pure CSS, no asset generation. Per specs/07-open-questions.md Q11.
 */
import type { TerminalStatus } from '@factorai/types';
import { StatusDot } from '@components/layout/StatusDot';
import { hashHue, pickInitials } from '@lib/icon';

interface ProjectIconProps {
	name: string;
	path: string;
	size?: number;
	/** Live PTY status for this project, badged on the icon's top-right corner
	 *  rather than sitting as one more thing in the row (F1). */
	status?: TerminalStatus;
}

export function ProjectIcon({ name, path, size = 24, status }: ProjectIconProps) {
	const hue = hashHue(path);
	const initials = pickInitials(name);
	const icon = (
		<span
			className="inline-flex size-full items-center justify-center rounded font-semibold text-white"
			style={{
				fontSize: Math.floor(size * 0.45),
				backgroundColor: `hsl(${hue}, 60%, 35%)`,
			}}
			aria-hidden
		>
			{initials}
		</span>
	);

	return (
		<span
			className="relative inline-block shrink-0"
			style={{ width: size, height: size }}
			data-testid="project-icon"
		>
			{icon}
			{status && (
				// Overlapping the corner, with a ring in the panel's own colour so the
				// badge reads as sitting on top of the avatar rather than inside it.
				<StatusDot
					status={status}
					// Seated INSIDE the corner rather than hung off it: the dot's own box
					// sits flush with the avatar's top-right, so only the 2px ring laps
					// over the edge. Most of the badge is on the avatar, which is what
					// makes it read as belonging to it.
					className="absolute top-px right-px size-1.5 ring-2 ring-card"
				/>
			)}
		</span>
	);
}
