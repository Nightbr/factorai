/**
 * Cheap hashed icon — initials over an HSL color derived from the project
 * path. Pure CSS, no asset generation. Per specs/07-open-questions.md Q11.
 */
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

function hashHue(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
	return Math.abs(h) % 360;
}

function pickInitials(name: string): string {
	const clean = name.replace(/^[-_.]+/, '');
	if (!clean) return '?';
	const parts = clean.split(/[\s\-_]+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return clean.slice(0, 2).toUpperCase();
}
