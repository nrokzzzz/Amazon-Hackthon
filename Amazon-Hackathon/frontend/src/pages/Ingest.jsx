import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Card } from '../ui.jsx';

const SAMPLE = `From: exam.cell@college.edu
Subject: URGENT — Exam fee last date

This is to inform all students that the last date to pay the end-semester
examination fee is this Friday. Students who fail to pay will be DEBARRED
from the examinations. This is mandatory.

---

From: placement@college.edu
Subject: TechCorp Drive — register now

TechCorp on-campus drive for CSE 3rd year is next week. Register on the
placement portal by Thursday. CTC up to 12 LPA.`;

export default function Ingest() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function pullPortal() {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await api.post('/ingest/portal');
      setResult({
        kind: 'portal',
        msg: `Pulled the college portal: ${data.totals.events} events extracted, ${data.totals.matches} matched to you${data.totals.skipped ? `, ${data.totals.skipped} duplicates skipped` : ''}.`,
      });
    } catch {
      setResult({ kind: 'error', msg: 'Failed to pull portal data.' });
    } finally {
      setBusy(false);
    }
  }

  async function pasteIngest() {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const { data } = await api.post('/ingest/paste', { text, source: 'email' });
      setResult({
        kind: 'paste',
        msg: data.skipped
          ? `Already ingested (duplicate).`
          : `Processed: ${data.events} event(s) extracted, ${data.matches} matched to you (engine: ${data.engine}).`,
      });
      setText('');
    } catch {
      setResult({ kind: 'error', msg: 'Processing failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/ingest/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult({
        kind: 'upload',
        msg: data.skipped
          ? `Already ingested (duplicate).`
          : `${data.filename}: ${data.events} event(s) extracted, ${data.matches} matched.`,
      });
    } catch {
      setResult({ kind: 'error', msg: 'Upload failed.' });
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">Inbox — bring in the chaos</h1>
      <p className="mt-1 text-slate-400">
        Drop in college emails, notices, or pull the portal. CampusFlow extracts, matches, and prioritizes.
      </p>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">📡 Pull the college portal</div>
            <div className="text-sm text-slate-400">Fetch attendance, deadlines, exams & notices (mock source).</div>
          </div>
          <Button onClick={pullPortal} disabled={busy}>{busy ? 'Working…' : 'Pull portal'}</Button>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="mb-2 font-medium">📋 Paste an email or notice</div>
        <textarea
          className="h-44 w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-100 outline-none focus:border-indigo-400"
          placeholder="Paste a messy college email or notice here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={pasteIngest} disabled={busy || !text.trim()}>Extract</Button>
          <Button variant="ghost" onClick={() => setText(SAMPLE)}>Use sample pile</Button>
          <label className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">
            Upload .eml / .txt
            <input type="file" accept=".eml,.txt,text/plain" className="hidden" onChange={uploadFile} />
          </label>
        </div>
      </Card>

      {result && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            result.kind === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-200'
          }`}
        >
          {result.msg}
        </div>
      )}

      <div className="mt-8">
        <Button variant="ghost" onClick={() => nav('/')}>See your Today feed →</Button>
      </div>
    </div>
  );
}
