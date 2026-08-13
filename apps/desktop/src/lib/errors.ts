import type { AppError } from '@factorai/types';

/** The tagged union Tauri commands reject with (see `error.rs`). */
function isAppError(e: unknown): e is AppError {
	if (typeof e !== 'object' || e === null) return false;
	const { kind, message } = e as { kind?: unknown; message?: unknown };
	return typeof kind === 'string' && typeof message === 'string';
}

/**
 * A readable line for anything a rejected command hands us.
 *
 * `AppError` crosses the boundary as `{ kind, message }` — a plain object, not
 * an `Error` — so the obvious `String(e)` renders `[object Object]`. That is
 * exactly what the terminal pane printed when a spawn failed, turning a
 * perfectly specific backend message ("working directory … does not exist")
 * into noise.
 */
export function formatError(e: unknown): string {
	if (isAppError(e)) return `${e.kind}: ${e.message}`;
	if (e instanceof Error) return e.message;
	if (typeof e === 'string') return e;
	return String(e);
}
