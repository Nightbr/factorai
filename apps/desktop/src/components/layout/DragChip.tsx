import { ProjectIcon } from '@components/layout/ProjectIcon';
import type { SidebarRow } from '@factorai/types';

/**
 * What you are holding, while you hold it (DESIGN.md's Lifted-Row Rule).
 *
 * **Compact and narrower than a row, which is the whole point.** The sidebar
 * used to drag the row itself, translated under the cursor — and once rows
 * stopped displacing to open a gap, that row sat exactly on top of the one it was
 * hovering and hid it. The drop line, the accent ring and the "New group" label
 * are all drawn on the *target*, so the target has to stay visible: measured in
 * the real window, holding a project over another showed nothing but a line,
 * because the affordance was underneath the row in your hand.
 *
 * So this rides in dnd-kit's `DragOverlay` instead, and the source row stays in
 * place, dimmed, marking where the thing came from.
 *
 * **This is one of the few places a shadow is correct** (Elevation): the chip
 * genuinely floats above the app and will be gone in a moment, which is exactly
 * the condition the Flat-By-Default Rule names for a shadow rather than a tonal
 * step.
 */
export function DragChip({ row }: { row: SidebarRow }) {
	return (
		<div
			data-testid="drag-chip"
			// `max-w-40`, not the sidebar's full width. dnd-kit positions the overlay
			// at the source row's rect, so a chip as wide as a row covers the target's
			// trailing slot — where the dwell's "New group" label lives. Measured in
			// the real window, where it read "EW GROUP".
			className="pointer-events-none inline-flex max-w-40 items-center gap-2 rounded border border-border bg-card px-2 py-1 text-foreground text-sm shadow-md"
		>
			{row.kind === 'project' ? (
				<>
					<ProjectIcon name={row.project.displayName} path={row.project.realPath} size={16} />
					<span className="min-w-0 truncate">{row.project.displayName}</span>
				</>
			) : (
				<>
					{/* A group has no avatar anywhere else in the sidebar, and does not
					    grow one here. Its name in the same 12px uppercase the row uses,
					    plus the count — which is the one thing a collapsed group can say
					    about itself, and a group is always collapsed while dragged. */}
					<span className="min-w-0 truncate font-medium text-muted-foreground text-xs uppercase tracking-wider">
						{row.name}
					</span>
					{row.children.length > 0 && (
						<span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
							{row.children.length}
						</span>
					)}
				</>
			)}
		</div>
	);
}
