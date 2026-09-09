import { createContext, type MutableRefObject, useContext, useRef } from 'react';

/**
 * What a viewer host may ask of the find widget inside it (specs/05-features.md
 * F7 § "Find").
 *
 * Two hosts need it and neither can reach the editor. `ViewerPane` forwards
 * `Cmd/Ctrl+F` because Monaco's own binding only fires when the editor has
 * focus, and the expand modal asks whether the widget is open before letting
 * `Escape` close the dialog.
 *
 * **A context and not a prop**, because `FileView` knows nothing about its host
 * on purpose (ADR-0037) and this is the third thing a host would have to thread
 * through it. **A ref and not state**, because publishing the handle must not
 * re-render the host: the editor is created in an effect and the handle is born
 * with it.
 *
 * **No Monaco here.** The whole point is that a statically-imported host can
 * hold one of these — importing `monaco.ts` from `FileViewerModal` would pull
 * the heaviest chunk in the app into the initial bundle (ADR-0007).
 */
interface FindHandle {
	/** Open the widget and focus its input. */
	open: () => void;
	/** True while the widget is on screen. */
	isRevealed: () => boolean;
}

/** Null in a host that does not provide one — every view still works, the key
 *  just does nothing above the editor. */
const FindHandleContext = createContext<MutableRefObject<FindHandle | null> | null>(null);

export const FindHandleProvider = FindHandleContext.Provider;

/** Host side: the slot to provide and to read. */
export function useFindHandleSlot(): MutableRefObject<FindHandle | null> {
	return useRef<FindHandle | null>(null);
}

/** Editor side: the slot to publish into while mounted, or null when the view
 *  is rendered somewhere that does not want one. */
export function useFindHandleSink(): MutableRefObject<FindHandle | null> | null {
	return useContext(FindHandleContext);
}

/** The modifier and key part of a keyboard event — a structural shape so this
 *  reads a React `KeyboardEvent`, a DOM one, or a literal in a test. */
export interface FindKeystroke {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
}

/**
 * Is this the find key?
 *
 * `Cmd` **or** `Ctrl`, matching how the rest of the app reads a modifier
 * (terminal links, the tree's open-in-viewer) rather than sniffing the
 * platform. `Alt` is excluded: `Alt+Cmd+F` is not this key, and on Linux
 * `Ctrl+Alt+F` is a virtual-console switch nobody meant for the viewer.
 */
export function isFindKey(event: FindKeystroke): boolean {
	if (event.key !== 'f' && event.key !== 'F') return false;
	return (event.metaKey || event.ctrlKey) && !event.altKey;
}
