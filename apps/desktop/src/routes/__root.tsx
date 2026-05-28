import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '@components/layout/AppShell';
import { events } from '@lib/tauri';
import { useIndexerStore } from '@store/indexerStore';

function RootLayout() {
	const setProgress = useIndexerStore((s) => s.setProgress);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		events.onIndexerProgress((p) => setProgress(p)).then((fn) => {
			unlisten = fn;
		});
		return () => unlisten?.();
	}, [setProgress]);

	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

export const rootRoute = createRootRoute({ component: RootLayout });
