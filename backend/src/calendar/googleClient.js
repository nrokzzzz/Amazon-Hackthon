import { google } from 'googleapis';
import { config, isGoogleConfigured } from '../config/env.js';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  // Read-only Gmail access so we can watch the inbox and fetch incoming mail.
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export function makeOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Build the consent URL. `state` carries our app JWT so we can tie the callback
// back to the logged-in student.
export function getAuthUrl(state) {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // => issues a refresh token
    prompt: 'consent', // force refresh token even on re-connect
    scope: CALENDAR_SCOPES,
    state,
  });
}

// Build an authorized Calendar client for a student using their stored refresh
// token. The googleapis client auto-refreshes access tokens as needed.
export function calendarForStudent(student) {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: student.gcal.refresh_token });
  return google.calendar({ version: 'v3', auth: client });
}

export { isGoogleConfigured };
