import type {
	Frontmatter,
	FrontmatterField,
	FrontmatterValue,
} from '@components/viewer/frontmatter';
import { isExternalUrl } from '@components/viewer/frontmatter';
import { CHIP_SHAPE } from '@lib/gitGraph';
import { openExternally } from '@lib/tauri';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * A markdown document's frontmatter, laid out as fields (F7).
 *
 * **Collapsible, and which way it starts is a preference** (`frontmatterOpen`,
 * F11). The two readers are genuinely different: somebody working through a
 * spec wants `status` and `owner` on screen, and somebody reading a document
 * whose frontmatter is bookkeeping wants the prose to start at the top of the
 * pane. Neither is a default the app can pick for both.
 *
 * The toggle is **not** written back to the preference, unlike the diff
 * viewer's inline switch. That one is a reading mode you stay in; this is a
 * disclosure you flick open to check a field, and a peek that silently changed
 * every future document would be a setting edited by accident.
 */
export function FrontmatterPanel({
	frontmatter,
	defaultOpen,
}: {
	frontmatter: Frontmatter;
	defaultOpen: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const fields = frontmatter.fields;

	return (
		<section
			data-testid="frontmatter"
			data-state={open ? 'open' : 'collapsed'}
			className="not-prose mb-6 overflow-hidden rounded border border-border bg-secondary/30"
		>
			<button
				type="button"
				data-testid="frontmatter-toggle"
				aria-expanded={open}
				onClick={() => setOpen((prev) => !prev)}
				className="group flex h-9 w-full items-center gap-1.5 px-2.5 text-left"
			>
				<ChevronRight
					aria-hidden
					className={`size-3.5 shrink-0 text-muted-foreground transition-all group-hover:text-primary ${
						open ? 'rotate-90' : ''
					}`}
				/>
				<span className="flex-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
					Frontmatter
				</span>
				{/* What is behind the chevron, only while it is closed: a count beside
				    an open panel restates something the reader is already looking at. */}
				{!open && (
					<span className="shrink-0 text-muted-foreground text-xs">{summaryOf(frontmatter)}</span>
				)}
			</button>

			{open &&
				(fields ? (
					<FieldList fields={fields} className="border-border/60 border-t px-3 py-2" />
				) : (
					<div className="border-border/60 border-t">
						{/* A block that would not parse keeps its source, under the reason,
						    the way a mermaid fence does — it is still what the author
						    wrote, and the reader has as much use for it as for a code
						    block. */}
						<p className="px-3 pt-1.5 text-muted-foreground text-xs">
							{frontmatter.error ?? 'Could not read this frontmatter.'}
						</p>
						<pre
							data-testid="frontmatter-raw"
							className="overflow-x-auto px-3 py-2 font-mono text-secondary-foreground text-xs"
						>
							{frontmatter.raw}
						</pre>
					</div>
				))}
		</section>
	);
}

function summaryOf(frontmatter: Frontmatter): string {
	const fields = frontmatter.fields;
	if (!fields) return 'unreadable';
	return fields.length === 1 ? '1 field' : `${fields.length} fields`;
}

/**
 * The fields themselves.
 *
 * A `<dl>` grid rather than a table: the key column sizes to its longest key
 * and stops, so a one-word value does not sit half a pane away from its name,
 * and a value that wraps wraps under itself rather than pushing the column.
 */
function FieldList({ fields, className }: { fields: FrontmatterField[]; className?: string }) {
	return (
		<dl
			className={`grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 ${className ?? ''}`}
		>
			{fields.map((field, i) => (
				// The key is not unique: YAML permits a duplicate, and `yaml` keeps
				// the last one — but a nested block can repeat a name its sibling
				// used, so position is what identifies a row here.
				<div key={`${field.key}-${i}`} className="col-span-2 grid grid-cols-subgrid">
					<dt className="truncate font-mono text-muted-foreground text-xs leading-5">
						{field.key}
					</dt>
					<dd className="min-w-0 text-secondary-foreground leading-5">
						<ValueCell value={field.value} />
					</dd>
				</div>
			))}
		</dl>
	);
}

function ValueCell({ value }: { value: FrontmatterValue }) {
	switch (value.kind) {
		case 'empty':
			// Not blank: a field with no value is a fact about the document, and an
			// empty cell reads as a rendering that gave up.
			return <span className="text-muted-foreground/60">—</span>;
		case 'text':
			return <TextValue text={value.text} />;
		case 'list':
			return (
				<div className="flex flex-wrap items-center gap-1">
					{value.items.map((item, i) => (
						// Position identifies an entry: a list may hold the same value
						// twice, and both times it is a row of its own.
						<ListItem key={`${i}-${item.kind}`} value={item} />
					))}
				</div>
			);
		case 'map':
			return <FieldList fields={value.fields} className="py-0.5" />;
	}
}

/**
 * One entry of a list, as a chip.
 *
 * `CHIP_SHAPE` rather than a shape of its own, in the app's neutral hue: these
 * are values, and the coloured chips are reserved for git refs, which mean
 * something by their colour.
 */
function ListItem({ value }: { value: FrontmatterValue }) {
	if (value.kind === 'text' || value.kind === 'empty') {
		return (
			<span
				className={`${CHIP_SHAPE} max-w-full border-border bg-secondary text-secondary-foreground`}
			>
				<span className="min-w-0 truncate">
					{value.kind === 'text' ? <TextValue text={value.text} /> : '—'}
				</span>
			</span>
		);
	}
	// A list of maps — a `reviewers:` list whose entries have names and roles.
	// Chips cannot hold that, so the entry keeps the field layout, indented.
	return (
		<div className="w-full border-border/60 border-l pl-2">
			<ValueCell value={value} />
		</div>
	);
}

/** A scalar. A URL is handed to the OS on click, exactly as a markdown link
 *  is — the frontmatter of a spec is where its tracking issue lives. */
function TextValue({ text }: { text: string }) {
	if (isExternalUrl(text)) {
		return (
			<a
				href={text}
				className="break-all text-primary hover:underline"
				onClick={(e) => {
					e.preventDefault();
					void openExternally(text);
				}}
			>
				{text}
			</a>
		);
	}
	// `pre-wrap` because a block scalar (`|`) is a value with line breaks in it,
	// and collapsing them would rewrite what the field says.
	return <span className="whitespace-pre-wrap break-words">{text}</span>;
}
