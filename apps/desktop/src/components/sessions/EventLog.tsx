import type { SessionEvent } from '@factorai/types';
import { EventCard } from './EventCard';

interface EventLogProps {
	events: SessionEvent[];
}

export function EventLog({ events }: EventLogProps) {
	if (events.length === 0) {
		return <p className="p-6 text-muted-foreground text-sm">Empty session.</p>;
	}
	return (
		<ul className="flex flex-col gap-2 p-6">
			{events.map((ev) => (
				<EventCard key={ev.uuid} event={ev} />
			))}
		</ul>
	);
}
