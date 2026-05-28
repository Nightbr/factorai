import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const showError = (label: string, err: unknown) => {
	const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
	root.innerHTML = `<pre style="color:#fff;background:#900;padding:16px;font:12px monospace;white-space:pre-wrap;">[${label}] ${msg}</pre>`;
};
window.addEventListener('error', (e) => showError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError('unhandledrejection', e.reason));

try {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
} catch (err) {
	showError('render', err);
}
