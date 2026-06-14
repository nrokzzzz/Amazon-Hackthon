import { google } from 'googleapis';
import { config, isGoogleConfigured } from '../config/env.js';

// Scopes requested at OAuth consent. Calendar events for syncing the digest, and
// read-only Gmail so we can watch the inbox and fetch incoming college mail.
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
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

// Build the consent URL. `state` carries our app JWT so the callback can tie
// the connection back to the logged-in user (by userId).
export function getAuthUrl(state) {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // => issues a refresh token
    prompt: 'consent', // force a refresh token even on re-connect
    scope: CALENDAR_SCOPES,
    state,
  });
}

// Authorized Calendar client for a connection, using its stored refresh token.
// googleapis auto-refreshes access tokens as needed.
export function calendarForConnection(conn) {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: conn.refresh_token });
  return google.calendar({ version: 'v3', auth: client });
}

// Authorized Gmail client for a connection, reusing the same OAuth refresh token.
// Requires the gmail.readonly scope (granted at connect).
export function gmailForConnection(conn) {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: conn.refresh_token });
  return google.gmail({ version: 'v1', auth: client });
}

export { isGoogleConfigured };
