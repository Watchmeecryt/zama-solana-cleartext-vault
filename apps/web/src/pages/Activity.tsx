import { useEffect, useState } from 'react';
import { loadActivity, type ActivityEvent } from '../lib/api.js';
import { listLocalActivity } from '../lib/activityStore.js';
import { describeError, shortAddress } from '../lib/format.js';

export function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const remote = await loadActivity();
        const local = listLocalActivity();
        const merged = [...local, ...remote].sort((a, b) => b.at - a.at);
        const seen = new Set<string>();
        const unique = merged.filter((event) => {
          if (seen.has(event.signature + event.label)) return false;
          seen.add(event.signature + event.label);
          return true;
        });
        if (!cancelled) setEvents(unique.slice(0, 40));
      } catch (cause) {
        if (!cancelled) setError(describeError(cause));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="stack">
      <div className="panel">
        <h2>Recent activity</h2>
        <p className="muted">Keeper actions and wallet transactions for this demo cluster.</p>
      </div>
      {error && <p className="status-err">{error}</p>}
      {events.length === 0 ? (
        <div className="panel muted">No transactions yet.</div>
      ) : (
        <div className="activity-list">
          {events.map((event) => (
            <article key={`${event.signature}-${event.at}`} className="activity-item">
              <div>
                <strong>{event.label}</strong>
                <div className="mono muted">{shortAddress(event.signature)}</div>
              </div>
              <time className="muted">{new Date(event.at).toLocaleTimeString()}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
