import { BrandWordmark } from '@components/brand/Brand';
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@factorai/ui';
import { useAddProject } from '@hooks/useAddProject';
import { useInstalledAgents } from '@hooks/useInstalledAgents';
import { useSettingsModal } from '@hooks/useSettingsModal';
import { useAddProjectStore } from '@store/addProjectStore';
import { ChevronDown, FolderPlus } from 'lucide-react';
import { type ComponentProps, forwardRef, type ReactNode } from 'react';
import { AgentMark } from './AgentMark';
import { ImportMenuItems } from './ImportMenuItems';

/**
 * The main pane of an empty workspace (F1 § "The empty state").
 *
 * The only screen where the way out is the only thing worth saying, so it is
 * said in the middle of the window at the size of a decision: two door tiles
 * of one size, the folder picker and the import door, breathing together
 * (DESIGN.md § Door Tile and § First-Run Halo, ADR-0067, ADR-0068). Both are the human's move
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
		// Two spacers, 2 : 3, rather than `justify-center`: the geometric middle
		// of a pane reads low, and the optical centre sits a little above it.
		<main className="flex h-full flex-col items-center p-8 text-center" data-testid="first-run">
			<div aria-hidden className="flex-[2]" />
			<h2>
				<BrandWordmark className="text-xl" />
			</h2>
			<h3 className="mt-6 font-semibold text-lg">No projects yet</h3>
			<p className="mt-2 max-w-lg text-muted-foreground text-sm">
				Add any folder, or bring in the ones Claude Code or Codex already knows.
			</p>
			<div className="mt-6 grid grid-cols-2 gap-4">
				<Halo>
					<DoorTile
						data-testid="empty-add-project"
						disabled={adding}
						onClick={() => void addProject()}
						icon={<FolderPlus className="size-5 text-primary" aria-hidden />}
						title="Add a folder"
						hint="Any folder on this machine"
					/>
				</Halo>
				<Halo>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<DoorTile
								data-testid="empty-open-import"
								icon={
									<span className="flex items-center gap-2 text-primary">
										<AgentMark agent="claude" className="size-5" aria-hidden />
										<AgentMark agent="codex" className="size-5" aria-hidden />
									</span>
								}
								corner={<ChevronDown className="size-4 text-muted-foreground" aria-hidden />}
								title="Import history"
								hint="From Claude Code or Codex"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-56">
							<ImportMenuItems label={(name) => name} />
						</DropdownMenuContent>
					</DropdownMenu>
				</Halo>
			</div>
			{error && (
				<p role="alert" className="mt-4 text-destructive text-xs" data-testid="add-project-error">
					{error}
				</p>
			)}
			{/* Adding still works — a folder is a folder — but nothing could be
			    started in it, and this is where that is cheapest to learn (F1). */}
			{installed.length === 0 && (
				<p className="mt-4 max-w-md text-muted-foreground text-xs" data-testid="first-run-no-agent">
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
			<div aria-hidden className="flex-[3]" />
		</main>
	);
}

/**
 * One door (DESIGN.md § Door Tile): a mark, a title and a one-line hint on the
 * panel tone, edged in amber. A `Button` underneath, so focus, disabled and the
 * keyboard are the primitive's; `forwardRef` and the rest props so a Radix
 * trigger can wrap it. The hover is a tonal step, not the amber fill `outline`
 * would give — the edge already says whose move it is.
 */
const DoorTile = forwardRef<
	HTMLButtonElement,
	ComponentProps<typeof Button> & {
		icon: ReactNode;
		title: string;
		hint: string;
		corner?: ReactNode;
	}
>(function DoorTile({ icon, title, hint, corner, className, ...rest }, ref) {
	return (
		<Button
			ref={ref}
			variant="outline"
			className={cn(
				'relative h-auto w-60 flex-col items-start gap-0 whitespace-normal rounded-lg border-primary/60 bg-card p-4 text-left hover:border-primary hover:bg-secondary hover:text-foreground',
				className,
			)}
			{...rest}
		>
			{corner && <span className="absolute top-4 right-4 [&_svg]:size-4!">{corner}</span>}
			<span className="flex h-5 items-center [&_svg]:size-5!">{icon}</span>
			<span className="mt-5 font-semibold text-foreground text-sm">{title}</span>
			<span className="mt-1 font-normal text-muted-foreground text-xs">{hint}</span>
		</Button>
	);
});

/**
 * The breathing ring around one tile. A layer of its own rather than the
 * tile's shadow: the animation never stops, so the two halos stay in step,
 * and hovering or focusing the tile only fades its layer out. Under reduced
 * motion the ring holds still at its resting glow.
 */
function Halo({ children }: { children: ReactNode }) {
	return (
		<div className="group relative">
			<span
				aria-hidden
				className="pointer-events-none absolute inset-0 animate-first-run-halo rounded-lg transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 motion-reduce:animate-none motion-reduce:shadow-[0_0_0_2px_color-mix(in_oklch,var(--primary)_22%,transparent)]"
				data-testid="first-run-halo"
			/>
			{children}
		</div>
	);
}
