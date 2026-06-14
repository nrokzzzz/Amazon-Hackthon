import { config } from '../config/env.js';

// Fetch a student's enrichment profile from the auth service. Used by the
// prioritization engine (goals / focus_subjects / areas_of_interest drive
// scoring + overlap resolution). Service-to-service, no token required.
//
// Tolerant of failure: if auth is down / the student isn't found, we return an
// empty profile {} so prioritization still works (just without goal steering).
export async function fetchProfile(userId) {
  if (!userId) return {};
  try {
    const url = `${config.authUrl}/internal/profile?userId=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    return data?.profile && typeof data.profile === 'object' ? data.profile : {};
  } catch (err) {
    console.error('[categorizer] profile fetch error:', err?.message || err);
    return {};
  }
}
