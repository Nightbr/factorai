import { create } from 'zustand';

interface RecordingState {
	/** True while the keyboard settings section is capturing a chord (F28). */
	active: boolean;
	setActive: (active: boolean) => void;
}

/**
 * Is a shortcut being recorded right now?
 *
 * **Every app binding is suspended while this is true**, and it has to be:
 * recording `Mod+W` would otherwise close the tab behind the modal on the way
 * to being saved, and recording `Mod+,` would re-open the settings you are
 * already in. The recorder wants the raw keystroke, which means nothing else
 * may act on it.
 *
 * Its own store rather than a preference: it is momentary, it is never
 * persisted, and putting it in `prefsStore` would write `localStorage` twice
 * per recording.
 */
export const useRecordingStore = create<RecordingState>()((set) => ({
	active: false,
	setActive: (active) => set({ active }),
}));
