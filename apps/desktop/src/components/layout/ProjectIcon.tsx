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
	return (
		// `inline-flex`, not `inline-block`, and the tile below is a FLEX child.
		//
		// As an inline-block wrapper around an inline-level tile, the tile sat on a
		// line box inside it and was pushed down by the inherited `line-height` —
		// so the coloured square rendered a couple of px below the wrapper's own
		// box while the badge, positioned against that wrapper, stayed at the top.
		// Avatar and badge were being laid out against two different rectangles.
		// A flex child is block-level: it fills the wrapper exactly, and there is
		// no line box left to shift it.
		//
		// `align-middle` matters only if this is ever dropped into running text
		// rather than a flex row, where an inline box would otherwise sit on the
		// text baseline and hang below it.
		<span
			className="relative inline-flex shrink-0 align-middle leading-none"
			style={{ width: size, height: size }}
			data-testid="project-icon"
		>
			<span
				className="flex size-full items-center justify-center rounded font-semibold text-white"
				style={{
					fontSize: Math.floor(size * 0.45),
					backgroundColor: `hsl(${hue}, 60%, 35%)`,
				}}
				data-testid="project-icon-tile"
				aria-hidden
			>
				{initials}
			</span>
			{status && (
				<StatusDot
					status={status}
					// Sat on the avatar's top-right corner: half the badge overflows to
					// the right, a little under half above. Expressed as translates of
					// the badge's OWN size, so the proportion holds at any `size` — a
					// negative pixel offset would drift as the avatar grows.
					//
					// Overflowing costs the layout nothing: the badge is absolutely
					// positioned, so the wrapper's box stays exactly the avatar's box and
					// the row's baseline never moves.
					className="-translate-y-[45%] absolute top-0 right-0 size-1.5 translate-x-1/2 ring-2 ring-card"
				/>
			)}
		</span>
	);
}
