import { BrandWordmark } from '@components/brand/Brand';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@factorai/ui';
import { useAddProject } from '@hooks/useAddProject';
import { useInstalledAgents } from '@hooks/useInstalledAgents';
import { useSettingsModal } from '@hooks/useSettingsModal';
import { useAddProjectStore } from '@store/addProjectStore';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { ImportMenuItems } from './ImportMenuItems';

/**
 * The main pane of an empty workspace (F1 § "The empty state").
 *
 * The only screen where the way out is the only thing worth saying, so it is
 * said in the middle of the window at the size of a decision: two amber
 * buttons of one size, the folder picker and the import door, breathing
 * together (DESIGN.md § First-Run Halo, ADR-0067). Both are the human's move
 * and neither is second — which one is right depends on whether an agent has
 * already worked in the folder.
 */
export function FirstRunHero() {
	const addProject = useAddProject();
	const adding = useAddProjectStore((s) => s.adding);
	const error = useAddProjectStore((s) => s.error);
	const installed = useInstalledAgents();
	const settings = useSettingsModal();

	return (
		<main
			className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
			data-testid="first-run"
		>
			<h2>
				<BrandWordmark className="text-xl" />
			</h2>
			<h3 className="mt-3 font-semibold text-lg">No projects yet</h3>
			<p className="max-w-lg text-muted-foreground text-sm">
				Add any folder, or bring in the ones Claude Code or Codex already knows.
			</p>
			{/* A grid of two equal tracks: each button is as wide as the wider
			    label, so the pair reads as one choice between equals. */}
			<div className="mt-3 inline-grid grid-cols-2 gap-3">
				<Halo>
					<Button
						size="lg"
						className="w-full"
						data-testid="empty-add-project"
						disabled={adding}
						onClick={() => void addProject()}
					>
						Add Project…
					</Button>
				</Halo>
				<Halo>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="lg" className="w-full" data-testid="empty-open-import">
								Import from…
								<ChevronDown aria-hidden />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="center" className="w-48">
							<ImportMenuItems label={(name) => name} />
						</DropdownMenuContent>
					</DropdownMenu>
				</Halo>
			</div>
			{error && (
				<p role="alert" className="text-destructive text-xs" data-testid="add-project-error">
					{error}
				</p>
			)}
			{/* Adding still works — a folder is a folder — but nothing could be
			    started in it, and this is where that is cheapest to learn (F1). */}
			{installed.length === 0 && (
				<p className="mt-2 max-w-md text-muted-foreground text-xs" data-testid="first-run-no-agent">
					No agent found. Install Claude Code or Codex, or set its path in{' '}
					<Button
						variant="link"
						className="h-auto p-0 text-xs"
						onClick={() => settings.open('agents')}
					>
						Settings → Agents
					</Button>
					.
				</p>
			)}
		</main>
	);
}

/**
 * The breathing ring around one button. A layer of its own rather than the
 * button's shadow: the animation never stops, so the two halos stay in step,
 * and hovering or focusing the button only fades its layer out. Under reduced
 * motion the ring holds still at its resting glow.
 */
function Halo({ children }: { children: ReactNode }) {
	return (
		<div className="group relative">
			<span
				aria-hidden
				className="pointer-events-none absolute inset-0 animate-first-run-halo rounded-md transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 motion-reduce:animate-none motion-reduce:shadow-[0_0_10px_1px_color-mix(in_oklch,var(--primary)_30%,transparent)]"
				data-testid="first-run-halo"
			/>
			{children}
		</div>
	);
}
