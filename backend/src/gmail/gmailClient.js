import { google } from 'googleapis';
import { makeOAuthClient } from '../calendar/googleClient.js';

// Build an authorized Gmail API client for a student, reusing the same OAuth
// refresh token we stored for Calendar. The googleapis client auto-refreshes
// access tokens as needed. Requires the gmail.readonly scope (granted at connect).
export function gmailForStudent(student) {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: student.gcal?.refresh_token });
  return google.gmail({ version: 'v1', auth: client });
}
