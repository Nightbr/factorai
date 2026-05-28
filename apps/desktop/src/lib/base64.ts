/**
 * Decode a base64 string to a Uint8Array. Used to deserialise PTY chunks
 * from `terminal:data` events for xterm.write().
 */
export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
