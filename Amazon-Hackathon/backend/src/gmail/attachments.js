import { extractAttachment } from '../attachments/extract.js';

// Walk a Gmail message's MIME tree, download every real attachment, and run each
// through the shared extractor. Returns:
//   { files:  [{ filename, mimeType, data }]  -> Gemini-native (PDF/image)
//     text:   '...concatenated extracted text...' -> docx/xlsx/csv/txt/html
//     names:  ['timetable.pdf', ...] }
export async function collectAttachments(gmail, messageId, payload) {
  const files = [];
  const textParts = [];
  const names = [];

  // Gather every part that is an actual attachment (has an attachmentId).
  const targets = [];
  const walk = (part) => {
    if (!part) return;
    if (part.body?.attachmentId) {
      targets.push({ attachmentId: part.body.attachmentId, filename: part.filename || '', mimeType: part.mimeType || '' });
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload);

  for (const t of targets) {
    if (!t.filename) continue; // inline images without filenames are usually signatures/logos
    try {
      const { data } = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: t.attachmentId,
      });
      if (!data?.data) continue;
      const buffer = Buffer.from(data.data, 'base64url'); // Gmail -> raw bytes

      const result = await extractAttachment(buffer, t.filename, t.mimeType);
      if (result.file) {
        files.push(result.file);
        names.push(t.filename);
      } else if (result.text) {
        textParts.push(result.text);
        names.push(t.filename);
      }
    } catch {
      /* skip unreadable attachment */
    }
  }

  return { files, text: textParts.join('\n\n'), names };
}
