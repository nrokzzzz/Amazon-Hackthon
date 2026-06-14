import { GoogleConnection } from '../models/GoogleConnection.js';
import { syncDigestItemsToCalendar } from './digestCalendar.js';

// Handler for one decoded 'digest.updated' message:
//   { userId, items:[{ category, title, summary, datetime, importance,
//                       amount, location, link, action_required, details }], updatedAt }
// For the message's userId, load the GoogleConnection; if connected, upsert a
// Google Calendar event for every dated item. Best-effort — errors are logged,
// never re-thrown (the kafka layer also guards), so the consumer never crashes.
export async function onDigestUpdated(value) {
  const userId = value?.userId;
  if (!userId) {
    console.error('[calendar] digest.updated: missing userId, skipping');
    return;
  }
  const items = Array.isArray(value.items) ? value.items : [];
  if (!items.length) return;

  const conn = await GoogleConnection.findOne({ userId: String(userId) });
  if (!conn || !conn.refresh_token) {
    return; // user hasn't connected Google — nothing to sync
  }

  try {
    const r = await syncDigestItemsToCalendar(conn, items);
    if (r.created || r.updated || r.failed) {
      console.log(
        `[calendar] digest.updated userId=${userId}: created=${r.created} updated=${r.updated} failed=${r.failed}`
      );
    }
  } catch (err) {
    console.error(`[calendar] digest.updated sync error for userId=${userId}:`, err?.message || err);
  }
}
