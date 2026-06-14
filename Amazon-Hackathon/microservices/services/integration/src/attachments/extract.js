import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import WordExtractor from 'word-extractor';

let wordExtractor; // lazy singleton for legacy .doc parsing
const getWordExtractor = () => (wordExtractor ||= new WordExtractor());

// Robust attachment reader. Given a file's bytes + name + declared MIME type, it
// returns ONE of:
//   { file: { filename, mimeType, data } }  -> base64; sent downstream as a native file
//                                              (PDFs + images: the categorizer reads/OCRs these)
//   { text: '...' }                          -> extracted text appended to the email text
//                                              (docx, xlsx/xls, csv, txt, html, pptx, doc)
//   { skipped: true, reason }                -> unsupported or too large

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // keep downstream requests reasonable

// Native inline types — sent as files, not text.
const NATIVE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function extOf(filename = '') {
  const m = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

// Gmail/clients sometimes send application/octet-stream; fall back to extension.
export function normalizeMime(filename, declared) {
  const d = (declared || '').toLowerCase();
  if (d && d !== 'application/octet-stream' && d !== 'binary/octet-stream') return d;
  return EXT_MIME[extOf(filename)] || d || 'application/octet-stream';
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function spreadsheetToText(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const blocks = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
    if (csv) blocks.push(`[Sheet: ${name}]\n${csv}`);
  }
  return blocks.join('\n\n');
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// .pptx is a zip; each slide's text lives in <a:t>…</a:t> runs in slideN.xml.
function pptxToText(buffer) {
  const zip = new AdmZip(buffer);
  const slideNum = (n) => Number((n.match(/slide(\d+)\.xml$/) || [])[1] || 0);
  const entries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNum(a.entryName) - slideNum(b.entryName));

  const slides = [];
  entries.forEach((e, i) => {
    const xml = e.getData().toString('utf-8');
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const joined = runs.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) slides.push(`[Slide ${i + 1}] ${joined}`);
  });
  return slides.join('\n');
}

export async function extractAttachment(buffer, filename = 'attachment', declaredMime = '') {
  if (!buffer || !buffer.length) return { skipped: true, reason: 'empty', filename };
  if (buffer.length > MAX_FILE_BYTES) return { skipped: true, reason: 'too_large', filename };

  const mimeType = normalizeMime(filename, declaredMime);
  const ext = extOf(filename);

  // 1) PDFs + images -> native file (best for timetable layouts/scans).
  if (NATIVE_MIME.has(mimeType)) {
    return { file: { filename, mimeType, data: buffer.toString('base64') } };
  }

  // 2) Word .docx -> raw text.
  if (mimeType === EXT_MIME.docx || ext === 'docx') {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value || '').trim();
      return text ? { text: `[Attachment: ${filename}]\n${text}` } : { skipped: true, reason: 'empty_docx', filename };
    } catch (err) {
      return { skipped: true, reason: `docx_error: ${err?.message || err}`, filename };
    }
  }

  // 3) Excel .xlsx/.xls -> CSV text per sheet.
  if (mimeType === EXT_MIME.xlsx || mimeType === EXT_MIME.xls || ext === 'xlsx' || ext === 'xls') {
    try {
      const text = spreadsheetToText(buffer).trim();
      return text ? { text: `[Attachment: ${filename}]\n${text}` } : { skipped: true, reason: 'empty_sheet', filename };
    } catch (err) {
      return { skipped: true, reason: `xlsx_error: ${err?.message || err}`, filename };
    }
  }

  // 4) Legacy Word .doc (OLE binary) -> text.
  if (mimeType === EXT_MIME.doc || ext === 'doc') {
    try {
      const doc = await getWordExtractor().extract(buffer);
      const text = (doc.getBody() || '').trim();
      return text ? { text: `[Attachment: ${filename}]\n${text}` } : { skipped: true, reason: 'empty_doc', filename };
    } catch (err) {
      return { skipped: true, reason: `doc_error: ${err?.message || err}`, filename };
    }
  }

  // 5) PowerPoint .pptx -> text from every slide.
  if (mimeType === EXT_MIME.pptx || ext === 'pptx') {
    try {
      const text = pptxToText(buffer).trim();
      return text ? { text: `[Attachment: ${filename}]\n${text}` } : { skipped: true, reason: 'empty_pptx', filename };
    } catch (err) {
      return { skipped: true, reason: `pptx_error: ${err?.message || err}`, filename };
    }
  }

  // 6) Plain text / CSV / HTML -> decode (strip tags for HTML).
  if (mimeType.startsWith('text/')) {
    let text = buffer.toString('utf-8');
    if (mimeType === 'text/html') text = htmlToText(text);
    text = text.trim();
    return text ? { text: `[Attachment: ${filename}]\n${text}` } : { skipped: true, reason: 'empty_text', filename };
  }

  return { skipped: true, reason: 'unsupported', filename, mimeType };
}
