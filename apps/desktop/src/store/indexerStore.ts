import type { IndexerProgressEvent } from '@factorai/types';
import { create } from 'zustand';

interface IndexerState {
	progress: IndexerProgressEvent | null;
	setProgress: (p: IndexerProgressEvent) => void;
}

export const useIndexerStore = create<IndexerState>((set) => ({
	progress: null,
	setProgress: (p) => set({ progress: p }),
}));
