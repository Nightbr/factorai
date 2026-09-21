import { createContext, useContext } from 'react';

/**
 * Which of the viewer's two hosts a `FileView` is rendering inside (F7,
 * ADR-0037).
 *
 * **Both hosts are mounted at once while the modal is open.** `ViewerPane` is
 * rendered by `AppShell` (and by `FileTreePanel` in the narrow layout), and
 * `FileViewerModal` is rendered by the root route; expanding does not unmount
 * the pane, it draws a dialog over it. Two `FileView`s therefore exist for the
 * same path, and for text, an image or a PDF that costs a little work nobody
 * sees.
 *
 * For media it is two decoders on one file — two pictures, and audibly two
 * soundtracks a few hundred milliseconds apart. `MediaView` is the only thing
 * that has to care, and this is how it finds out which copy it is: with
 * `expanded` from `viewerStore`, `'modal'` is the one on screen, and otherwise
 * `'pane'` is.
 *
 * Deliberately *not* fixed by having the pane stop rendering `FileView` while
 * expanded. That would be the structural answer and it would take Monaco's
 * scroll position and caret with it every time a reader expanded and collapsed
 * a text file — a regression in the common case to fix a fault in the rare one.
 */
type ViewerHostKind = 'pane' | 'modal';

/** `'pane'` by default: a `FileView` rendered outside either host — a test, a
 *  future third host — is the one on screen as far as it knows, which is the
 *  behaviour that plays rather than the one that sits silent. */
const ViewerHostContext = createContext<ViewerHostKind>('pane');

export const ViewerHostProvider = ViewerHostContext.Provider;

export function useViewerHost(): ViewerHostKind {
	return useContext(ViewerHostContext);
}

/**
 * Whether this host is the one the reader is looking at.
 *
 * Pure, and exported for its own test: the whole handover turns on it, and
 * getting it backwards means both players run or neither does.
 */
export function hostIsShowing(host: ViewerHostKind, expanded: boolean): boolean {
	return expanded ? host === 'modal' : host === 'pane';
}
