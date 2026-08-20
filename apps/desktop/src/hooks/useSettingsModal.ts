import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import { type SettingsSection, isSettingsSection } from '@lib/settingsDraft';

/**
 * Which settings section is open, held in the URL as `?settings=<section>`
 * (F11, Q24).
 *
 * **A modal whose state lives in the URL, rather than a route.** The route's
 * real advantages were deep links, surviving a reload and browser-back closing
 * the thing — all three come from the URL, none of them from being a route. So
 * the session stays visible behind the modal, Esc dismisses it, and `?file=`'s
 * pattern is reused rather than a second mechanism invented. `validateSearch`
 * lives on the root route, so every route inherits the param.
 */
export function useSettingsModal(): {
	section: SettingsSection | null;
	/** Open the modal, at `claude` unless a section is named. */
	open: (section?: SettingsSection) => void;
	close: () => void;
} {
	const search = useSearch({ strict: false }) as { settings?: SettingsSection };
	const navigate = useNavigate();

	const open = useCallback(
		(section: SettingsSection = 'claude') => {
			void navigate({ to: '.', search: (prev) => ({ ...prev, settings: section }) });
		},
		[navigate],
	);

	const close = useCallback(() => {
		void navigate({ to: '.', search: (prev) => ({ ...prev, settings: undefined }) });
	}, [navigate]);

	return {
		section: isSettingsSection(search.settings) ? search.settings : null,
		open,
		close,
	};
}
