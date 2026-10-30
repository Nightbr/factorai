import type { SopsAwsContext } from '@factorai/types';

/**
 * Which AWS profile the viewer's picker starts on for a SOPS file (F27 §
 * "Choosing the AWS profile").
 *
 * In order: the file's own `aws_profile`, which `sops` uses whatever we say;
 * the profile chosen for this file last time; the one whose account matches the
 * file's KMS key; the app's `AWS_PROFILE`; `default`; the first listed. Each
 * candidate after the first counts only when it is still a profile on this
 * machine — a remembered name whose profile was deleted must not be sent to
 * `sops` as if it were real.
 */
export function initialAwsProfile(
	ctx: SopsAwsContext,
	remembered: string | undefined,
): string | null {
	if (ctx.fileProfile) return ctx.fileProfile;
	const names = ctx.profiles.map((p) => p.name);
	for (const candidate of [remembered, ctx.suggested, ctx.envProfile, 'default']) {
		if (candidate && names.includes(candidate)) return candidate;
	}
	return names[0] ?? null;
}

/**
 * The profile to hand `sops`, or `null` to send none. A profile named in the
 * file is not re-sent: `sops` reads it from the metadata, and passing it again
 * would only blur which of the two decided.
 */
export function awsProfileToSend(
	ctx: SopsAwsContext | null | undefined,
	chosen: string | null,
): string | null {
	if (!ctx || ctx.fileProfile) return null;
	return chosen;
}
