import express from 'express';
import { attendance, notices, deadlines, exams } from './data.js';

export const portalRouter = express.Router();

// Mock college portal endpoints (Feature 2). Public-ish read endpoints that
// stand in for a real college API / scrape. Data is generic (whole college).
portalRouter.get('/attendance', (_req, res) => res.json({ attendance: attendance() }));
portalRouter.get('/notices', (_req, res) => res.json({ notices: notices() }));
portalRouter.get('/deadlines', (_req, res) => res.json({ deadlines: deadlines() }));
portalRouter.get('/exams', (_req, res) => res.json({ exams: exams() }));

// Everything in one call — convenient for the demo "drop in the pile" moment.
portalRouter.get('/all', (_req, res) => {
  res.json({
    attendance: attendance(),
    notices: notices(),
    deadlines: deadlines(),
    exams: exams(),
  });
});
