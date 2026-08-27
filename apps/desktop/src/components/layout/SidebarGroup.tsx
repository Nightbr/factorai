import { DwellRing } from '@components/layout/DwellRing';
import { SidebarProject } from '@components/layout/SidebarProject';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import type { SidebarRow, TerminalStatus } from '@factorai/types';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	IconButton,
} from '@factorai/ui';
import { useSidebarStore } from '@store/sidebarStore';
import { ArrowDown, ArrowUp, ChevronRight, Trash2 } from 'lucide-react';

type GroupRow = Extract<SidebarRow, { kind: 'group' }>;

interface SidebarGroupProps {
	row: GroupRow;
	canReorder: boolean;
	activeProjectId: string | undefined;
	statusByProject: Map<string, TerminalStatus | undefined>;
	onNudge: (rowId: string, delta: -1 | 1) => void;
	/** 0 → 1 while a drag rests on this collapsed group and the spring-open is
	 *  filling. The same ring the group offer uses, because there is one timed
	 *  gesture and it should look like one thing (F1). */
	dwellProgress?: number;
	dwelling?: boolean;
	/** Opens the inline name editor. Undefined while the group cannot be renamed
	 *  — which is only the case under a derived sort, where group rows are not
	 *  rendered at all, so in practice it is always supplied. */
	onRename?: (rowId: string) => void;
	onRemove?: (row: GroupRow) => void;
	/** True while the group's name is being edited, which swaps the label for an
	 *  `InlineEdit`. Owned by the sidebar rather than this row so that creating a
	 *  group can open the editor on a row that has only just appeared. */
	editing?: boolean;
	renameEditor?: React.ReactNode;
	/** Passed straight through to the projects inside, which carry the
	 *  `Move to group ▸` submenu — a group row has no use for them itself. */
	groups?: { rowId: string; name: string }[];
	onMoveToGroup?: (rowId: string, groupRowId: string | null) => void;
	onRemoveFromGroup?: (rowId: string) => void;
}

/**
 * A group: a row that holds projects (specs/05-features.md F1, ADR-0025).
 *
 * **Row anatomy mirrors a project row** — same height, same chevron, same hover
 * behaviour — so the sidebar reads as one list where some rows expand, rather
 * than two kinds of thing stacked together. What it deliberately does *not*
 * have:
 *
 * - **No avatar.** `ProjectIcon` hashes its hue from a path, and a group has no
 *   path; a coloured square with no folder behind it would be inventing an
 *   identity the group does not have.
 * - **No `+`.** There is no cwd to start a session in. A button that had to pick
 *   one of the group's projects for you is a worse answer than no button.
 *
 * The **count appears only when collapsed**, where it is the one thing that can
 * say what is inside. Expanded, it would be telling you something you can
 * already see, while competing with the name for a 180px row.
 */
export function SidebarGroup({
	row,
	canReorder,
	activeProjectId,
	statusByProject,
	onNudge,
	dwellProgress = 0,
	dwelling = false,
	onRename,
	onRemove,
	editing = false,
	renameEditor,
	groups = [],
	onMoveToGroup,
	onRemoveFromGroup,
}: SidebarGroupProps) {
	const expanded = useSidebarStore((s) => s.expanded.includes(row.rowId));
	const toggle = useSidebarStore((s) => s.toggleProject);
	// Keyed by the row id, like a project row — see `SidebarProject`'s `rowId`.
	const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
		id: row.rowId,
		// A group being edited must not also be draggable: the pointer sensor would
		// claim the click that places the caret.
		disabled: !canReorder || editing,
	});

	return (
		<li
			ref={setNodeRef}
			style={{ transform: DndCss.Translate.toString(transform), transition }}
			className={isDragging ? 'relative z-10' : undefined}
			data-testid={`group-${row.rowId}`}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						{...(editing ? {} : listeners)}
						onKeyDown={
							canReorder && !editing
								? (e) => {
										if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
										e.preventDefault();
										onNudge(row.rowId, e.key === 'ArrowUp' ? -1 : 1);
									}
								: undefined
						}
						aria-keyshortcuts={canReorder && !editing ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
						// The same lift as a project row: tonal step plus a hairline ring,
						// no shadow (DESIGN.md's Lifted-Row Rule).
						className={`group flex items-center pr-1 transition-colors ${
							canReorder && !editing ? 'touch-none select-none' : ''
						} ${
							isDragging
								? 'bg-secondary ring-1 ring-border'
								: dwelling
									? 'bg-secondary ring-1 ring-primary'
									: 'hover:bg-secondary/50'
						}`}
					>
						<IconButton
							aria-label={expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
							aria-expanded={expanded}
							className="my-1 mr-1 ml-1"
							onClick={() => toggle(row.rowId)}
						>
							<ChevronRight className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
						</IconButton>

						{editing && renameEditor ? (
							renameEditor
						) : (
							<>
								{/* A button rather than a link: a group has nowhere to navigate
								    to. Clicking it expands, which is what clicking a container
								    should do — and it means the chevron is a convenience rather
								    than the only target in a 180px row. */}
								<button
									type="button"
									onClick={() => toggle(row.rowId)}
									onDoubleClick={onRename ? () => onRename(row.rowId) : undefined}
									// Uppercase and tracked like the PROJECTS header, at the same
									// 12px: a group names a section of the list, and reading as a
									// quiet heading is what keeps it from competing with the
									// project names it contains.
									className="flex min-w-0 flex-1 items-center py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider transition-colors group-hover:text-foreground"
									title={`${row.name} — ${row.children.length} project${
										row.children.length === 1 ? '' : 's'
									}`}
								>
									<span className="min-w-0 flex-1 truncate">{row.name}</span>
								</button>
								{/* The ring takes the count's slot while a drag is being timed on
								    this row, so a collapsed group does not change width as it is
								    about to spring open. */}
								{dwellProgress > 0 ? (
									<span className="shrink-0 pr-1">
										<DwellRing progress={dwellProgress} />
									</span>
								) : (
									!expanded &&
									row.children.length > 0 && (
										<span className="shrink-0 pr-1 text-muted-foreground/70 text-xs tabular-nums">
											{row.children.length}
										</span>
									)
								)}
							</>
						)}
					</div>
				</ContextMenuTrigger>
				{/* Focus is not returned to the row: `Rename…` mounts an inline editor
				    that focuses itself, and Radix's close-time refocus would blur it
				    straight back out (an editor that commits on blur then closes
				    instantly). Nothing here needs the row focused afterwards. */}
				<ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
					{onRename && (
						<ContextMenuItem onSelect={() => onRename(row.rowId)}>Rename…</ContextMenuItem>
					)}
					{canReorder && (
						<>
							<ContextMenuItem onSelect={() => onNudge(row.rowId, -1)}>
								<ArrowUp />
								Move up
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => onNudge(row.rowId, 1)}>
								<ArrowDown />
								Move down
							</ContextMenuItem>
						</>
					)}
					<ContextMenuSeparator />
					{/* Below the separator, like Remove Project: it is the one row here
					    that cannot be undone with a click. */}
					<ContextMenuItem
						variant="destructive"
						data-testid={`remove-group-${row.rowId}`}
						onSelect={() => onRemove?.(row)}
					>
						<Trash2 />
						Remove Group
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{expanded && (
				<ul className="space-y-0.5" data-testid={`group-children-${row.rowId}`}>
					{row.children.map((child) => (
						<SidebarProject
							key={child.rowId}
							rowId={child.rowId}
							project={child.project}
							isActive={activeProjectId === child.project.id}
							liveStatus={statusByProject.get(child.project.id)}
							canReorder={canReorder}
							onNudge={onNudge}
							parentGroupRowId={row.rowId}
							groups={groups}
							onMoveToGroup={onMoveToGroup}
							onRemoveFromGroup={onRemoveFromGroup}
						/>
					))}
					{/* **An empty group says so, and the row that says it is the drop
					    target.** The placeholder and the affordance are the same thing,
					    which is why this is not just italic text: a group you made and
					    have not filled yet needs somewhere to aim at. It stays rather
					    than being tidied away — you made the container on purpose. */}
					{row.children.length === 0 && <EmptyGroupHint rowId={row.rowId} />}
				</ul>
			)}
		</li>
	);
}

/**
 * The row an empty expanded group shows, which is also its drop target.
 *
 * **A droppable of its own, under a prefixed id.** The group's `<li>` is already
 * a *sortable* registered under `row.rowId`, and dnd-kit cannot have two
 * droppables sharing an id — so this one is `empty:<rowId>` and the sidebar's
 * `onDragEnd` strips the prefix. Dropping here therefore resolves to exactly the
 * same `moveRow(tree, active, groupRowId)` call that dropping on the group's
 * header does, rather than being a second rule to keep in step.
 *
 * Without it, an empty group would be unreachable by drag: `SortableContext` has
 * no item to collide with inside a group with no children, so the drop would
 * land on whatever row happened to be next.
 */
function EmptyGroupHint({ rowId }: { rowId: string }) {
	const { setNodeRef, isOver } = useDroppable({ id: `empty:${rowId}` });

	return (
		<li ref={setNodeRef}>
			<p
				data-testid={`group-empty-${rowId}`}
				className={`py-1.5 pl-8 text-sm transition-colors ${
					// The same hairline the lifted row uses, so "this will accept the
					// drop" is said with the elevation model rather than a new colour.
					isOver
						? 'rounded bg-secondary text-foreground ring-1 ring-border'
						: 'text-muted-foreground/60'
				}`}
			>
				Drop a project here
			</p>
		</li>
	);
}
