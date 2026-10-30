import type { SopsAwsContext } from '@factorai/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@factorai/ui';
import { Cloud } from 'lucide-react';

/**
 * The AWS profile a SOPS file is decrypted and re-encrypted with (F27 §
 * "Choosing the AWS profile").
 *
 * Drawn only for a file whose metadata names an AWS KMS key — the caller has a
 * context only then. Beside the Decrypt control, because it answers the one
 * question Decrypt cannot: *as whom*. The choice is handed to `sops` as
 * `AWS_PROFILE` and never written into the file.
 *
 * Three states besides the ordinary one, each with its reason in the `title`
 * (one line — WebKitGTK renders only the first):
 * - the file names its own profile: shown, and locked, since `sops` uses it
 *   whatever is chosen here;
 * - no profiles on this machine: shown disabled, so the reader learns where
 *   the list comes from rather than finding no control at all.
 */
export function AwsProfilePicker({
	context,
	value,
	disabled,
	onChange,
}: {
	context: SopsAwsContext;
	value: string | null;
	disabled: boolean;
	onChange: (profile: string) => void;
}) {
	const locked = !!context.fileProfile;
	const empty = context.profiles.length === 0;
	const account = context.accountIds.join(', ');
	const title = locked
		? `This file names its own AWS profile (${context.fileProfile}), and sops uses it`
		: empty
			? 'No AWS profile in ~/.aws/config or ~/.aws/credentials'
			: `AWS profile used to reach this file's KMS key${account ? ` · account ${account}` : ''}`;
	// A locked or remembered name that is not in the list still has to be an
	// item, or Radix shows the placeholder instead of the value.
	const names = context.profiles.map((p) => p.name);
	const items = value && !names.includes(value) ? [value, ...names] : names;

	return (
		<Select
			value={value ?? undefined}
			onValueChange={onChange}
			disabled={disabled || locked || empty}
		>
			<SelectTrigger
				aria-label="AWS profile"
				data-testid="viewer-aws-profile"
				title={title}
				className="h-6 w-auto max-w-44 shrink gap-1.5 border-0 bg-transparent px-1.5 text-xs hover:text-foreground focus:ring-0 [&>svg]:size-3"
			>
				<Cloud className="size-3 shrink-0 opacity-70" />
				{/* The name alone in the trigger: an item's account hint is for
				    choosing, and in a 28px footer it would push the metadata out. */}
				<SelectValue placeholder="No AWS profiles">{value}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{items.map((name) => {
					const id = context.profiles.find((p) => p.name === name)?.accountId;
					const matches = !!id && context.accountIds.includes(id);
					return (
						<SelectItem key={name} value={name} data-testid={`viewer-aws-profile-${name}`}>
							{name}
							{matches && <span className="ml-2 text-muted-foreground">this file's account</span>}
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
