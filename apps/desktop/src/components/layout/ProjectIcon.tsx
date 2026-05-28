/**
 * Cheap hashed icon — initials over an HSL color derived from the project
 * path. Pure CSS, no asset generation. Per specs/07-open-questions.md Q11.
 */
import { hashHue, pickInitials } from '@lib/icon';

interface ProjectIconProps {
	name: string;
	path: string;
	size?: number;
}

export function ProjectIcon({ name, path, size = 24 }: ProjectIconProps) {
	const hue = hashHue(path);
	const initials = pickInitials(name);
	return (
		<span
			className="inline-flex shrink-0 items-center justify-center rounded font-semibold text-white"
			style={{
				width: size,
				height: size,
				fontSize: Math.floor(size * 0.45),
				backgroundColor: `hsl(${hue}, 60%, 35%)`,
			}}
			aria-hidden
		>
			{initials}
		</span>
	);
}
