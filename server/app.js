/**
 * server/app.js
 * Express application: middleware, routes, error handler.
 * Exported for use by both server/index.js (dev) and api/index.js (Vercel).
 */

import express from 'express';
import voiceRouter from './routes/voice.js';
import ticketsRouter from './routes/tickets.js';
import healthRouter from './routes/health.js';

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=()');
  next();
});

// ─── CORS (same-origin in production, dev-friendly locally) ──────────────────

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow same-origin and localhost in development
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
  ];

  if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-pin');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10kb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/voice', voiceRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/health', healthRouter);

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  // Never expose stack traces to users
  const status = err?.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({
    error: status === 413
      ? 'Request is too large. Please shorten your message and try again.'
      : 'Something went wrong. Please try again.',
  });
});

export default app;
