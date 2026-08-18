/**
 * The one line a panel tab shows in place of a list: no project, still loading,
 * no repository, nothing to show (F13, F18).
 *
 * **Shared because it wasn't.** Files, Changes and Graph each carried their own
 * identical `Empty`, and identical is how three things stop being identical: the
 * graph's line sat 4px above the other two, because Files and Changes render
 * inside the `py-1` scroll wrapper `FileTreePanel` puts around them and the graph
 * — which owns its own scrolling — renders outside it. Nothing in either place
 * said the 4px was load-bearing. It is one component now, and the graph repeats
 * the wrapper's padding explicitly (`GraphView` § `Empty`).
 */
export function PanelEmpty({ children }: { children: string }) {
	return <p className="px-3 py-2 text-muted-foreground text-xs">{children}</p>;
}
