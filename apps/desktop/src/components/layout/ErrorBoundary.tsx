import { Button } from '@factorai/ui';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { type CrashContext, crashReport, issueUrl } from '@lib/crashReport';
import { openExternally } from '@lib/tauri';

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	error: Error | null;
	componentStack: string | null;
}

/**
 * The app's outermost error boundary (specs/05-features.md F17).
 *
 * Without it, a throw during render unmounts the tree and leaves an empty
 * window — no message, and in a desktop app no address bar to reload from
 * either. This is the floor: **one** boundary, at the root, so a render error
 * anywhere becomes a screen you can act on instead of a blank one.
 *
 * What no React boundary catches, this one included: errors in event handlers,
 * in `setTimeout`, in unhandled promise rejections — anything thrown outside
 * the render phase. Those belong to the toast path (roadmap item 7), which is
 * the *expected*-failure surface. Keep the two separate: a toast is useless
 * when the tree is already gone, and this screen is far too much for a command
 * that returned an `AppError`.
 *
 * **Root-only is a deliberate first cut** (decided 2026-08-17), not an
 * oversight. Per-surface boundaries — so a broken file tree cannot take a
 * running terminal's pane down with it — are the next step and are recorded in
 * the roadmap rather than half-built here.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null, componentStack: null };

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// The component stack is only available here, not in
		// getDerivedStateFromError.
		this.setState({ componentStack: info.componentStack ?? null });
		// DevTools is the other place a developer looks, and React's own logging
		// of uncaught errors is not something to rely on.
		console.error('[factorai] uncaught render error', error, info.componentStack);
	}

	render(): ReactNode {
		const { error, componentStack } = this.state;
		if (!error) return this.props.children;
		return <CrashScreen error={error} componentStack={componentStack} />;
	}
}

interface CrashScreenProps {
	error: Error;
	componentStack: string | null;
}

/**
 * Shows the error rather than hiding it. The person using this app is a
 * developer, and a redacted "something went wrong" wastes the one moment the
 * information exists.
 */
function CrashScreen({ error, componentStack }: CrashScreenProps) {
	const ctx: CrashContext = {
		name: error.name,
		message: error.message,
		componentStack,
		version: __APP_VERSION__,
		userAgent: navigator.userAgent,
	};

	return (
		<div
			className="flex h-screen w-full items-center justify-center bg-background p-8"
			data-testid="crash-screen"
		>
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h1 className="font-semibold text-foreground text-lg">Something crashed</h1>
					<p className="text-muted-foreground text-sm">
						factorai hit an error it could not render through. Your sessions are still running.
					</p>
				</div>

				<pre
					className="max-h-72 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-foreground text-xs"
					data-testid="crash-detail"
				>
					{`${error.name}: ${error.message}`}
					{componentStack ? `\n${componentStack.trim()}` : ''}
				</pre>

				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={() => window.location.reload()} data-testid="crash-reload">
						<RefreshCw /> Reload
					</Button>
					<Button
						variant="outline"
						onClick={() => void openExternally(issueUrl(ctx))}
						data-testid="crash-report"
					>
						<ExternalLink /> Report an issue
					</Button>
					<Button
						variant="outline"
						onClick={() => void navigator.clipboard.writeText(crashReport(ctx))}
						data-testid="crash-copy"
					>
						<Copy /> Copy details
					</Button>
				</div>

				{/* Stated rather than left to be discovered: the PTYs survive a reload
				    — they live in Rust state, and terminalStore re-syncs from
				    terminal_list — but nothing snapshots xterm's scrollback, so the
				    panes come back empty. */}
				<p className="text-muted-foreground text-xs">
					Reloading keeps your sessions alive but clears the terminal scrollback.
				</p>
			</div>
		</div>
	);
}
