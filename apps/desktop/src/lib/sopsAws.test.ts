import type { SopsAwsContext } from '@factorai/types';
import { describe, expect, it } from 'vitest';
import { awsProfileToSend, initialAwsProfile } from './sopsAws';

function ctx(overrides: Partial<SopsAwsContext> = {}): SopsAwsContext {
	return {
		profiles: [
			{ name: 'default', accountId: null },
			{ name: 'prod', accountId: '222222222222' },
			{ name: 'staging', accountId: '111111111111' },
		],
		accountIds: ['111111111111'],
		suggested: 'staging',
		fileProfile: null,
		envProfile: null,
		...overrides,
	};
}

describe('initialAwsProfile', () => {
	it('starts on the profile named in the file, whatever else is known', () => {
		expect(initialAwsProfile(ctx({ fileProfile: 'ci' }), 'prod')).toBe('ci');
	});

	it('prefers the remembered choice over the suggestion', () => {
		expect(initialAwsProfile(ctx(), 'prod')).toBe('prod');
	});

	it('ignores a remembered profile that no longer exists', () => {
		expect(initialAwsProfile(ctx(), 'deleted')).toBe('staging');
	});

	it('falls back to the suggestion, then AWS_PROFILE, then default, then the first', () => {
		expect(initialAwsProfile(ctx(), undefined)).toBe('staging');
		expect(initialAwsProfile(ctx({ suggested: null, envProfile: 'prod' }), undefined)).toBe('prod');
		expect(initialAwsProfile(ctx({ suggested: null }), undefined)).toBe('default');
		expect(
			initialAwsProfile(
				ctx({ suggested: null, profiles: [{ name: 'only', accountId: null }] }),
				undefined,
			),
		).toBe('only');
	});

	it('has nothing to start on when the machine has no profiles', () => {
		expect(initialAwsProfile(ctx({ profiles: [], suggested: null }), undefined)).toBeNull();
	});
});

describe('awsProfileToSend', () => {
	it('sends the choice for a file with no profile of its own', () => {
		expect(awsProfileToSend(ctx(), 'prod')).toBe('prod');
	});

	it('sends nothing when the file names its profile, or has no AWS key', () => {
		expect(awsProfileToSend(ctx({ fileProfile: 'ci' }), 'ci')).toBeNull();
		expect(awsProfileToSend(null, 'prod')).toBeNull();
	});
});
