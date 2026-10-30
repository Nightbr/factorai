import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deferredLocalStorage } from '@lib/persistStorage';

/**
 * The AWS profile chosen for each SOPS file, so the next Decrypt does not ask
 * again (F27 § "Choosing the AWS profile").
 *
 * **Keyed by the file's absolute path**, which is per checkout: staging and
 * production secrets usually sit in different files of one repository and
 * belong to different accounts, so a per-repository choice would be wrong for
 * one of them every time.
 *
 * A renderer-only preference (ADR-0013), and its own store rather than a field
 * of `prefsStore`: that one is the settings modal's, replaced whole by Save, and
 * a map that grows by one entry per file opened is not a setting anybody edits.
 * A profile name is not a secret; nothing here is.
 */
interface SopsProfileState {
	byPath: Record<string, string>;
	remember: (path: string, profile: string) => void;
}

export const useSopsProfileStore = create<SopsProfileState>()(
	persist(
		(set) => ({
			byPath: {},
			remember: (path, profile) => set((s) => ({ byPath: { ...s.byPath, [path]: profile } })),
		}),
		{
			name: 'factorai.sopsAwsProfiles',
			storage: deferredLocalStorage(),
			version: 1,
			partialize: (s) => ({ byPath: s.byPath }),
		},
	),
);
