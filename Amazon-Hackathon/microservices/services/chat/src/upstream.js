import { config } from './config/env.js';

// ---------------------------------------------------------------------------
// Service-to-service fetches. This service has NO direct access to CollegeInfo
// or Student — it pulls grounding context from the categorizer and the student
// profile from auth, both via their internal endpoints.
// ---------------------------------------------------------------------------

// GET ${CATEGORIZER_URL}/internal/context?userId=<id>
//   -> { digestText, prioritiesText, items }
// `items` is a flat array of the student's LIVE college items (used by the
// keyword fallback). On any failure we degrade to empty context.
export async function fetchContext(userId) {
  try {
    const url = `${config.categorizerUrl}/internal/context?userId=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`categorizer_http_${res.status}`);
    const data = await res.json();
    return {
      digestText: data.digestText || '(no college information stored yet)',
      prioritiesText: data.prioritiesText || '(no tasks yet)',
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return {
      digestText: '(no college information stored yet)',
      prioritiesText: '(no tasks yet)',
      items: [],
    };
  }
}

// GET ${AUTH_URL}/internal/profile?userId=<id>
//   -> { profile, branch, current_year, name }
export async function fetchProfile(userId) {
  try {
    const url = `${config.authUrl}/internal/profile?userId=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`auth_http_${res.status}`);
    const data = await res.json();
    return {
      profile: data.profile || {},
      branch: data.branch || '',
      current_year: data.current_year ?? null,
      name: data.name || '',
    };
  } catch {
    return { profile: {}, branch: '', current_year: null, name: '' };
  }
}
