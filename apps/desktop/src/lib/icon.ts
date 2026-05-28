/**
 * Pure helpers for the hashed-initials project icon (specs Q11). Extracted
 * so they can be unit-tested without a React renderer.
 */

export function hashHue(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
	return Math.abs(h) % 360;
}

export function pickInitials(name: string): string {
	const clean = name.replace(/^[-_.]+/, '');
	if (!clean) return '?';
	const parts = clean.split(/[\s\-_]+/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return clean.slice(0, 2).toUpperCase();
}
