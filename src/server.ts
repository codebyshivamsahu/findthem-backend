// src/server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { initDatabase, ping, closeDatabase } from './db/database';
import { apiLimiter } from './middleware/rateLimit';
import { respondWithError } from './utils/errors';
import authRoutes from './routes/auth';
import casesRoutes from './routes/cases';
import sightingsRoutes from './routes/sightings';
import statisticsRoutes from './routes/statistics';

const app = express();

// Render / any reverse proxy: needed for correct client IPs in rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
  origin(origin, callback) {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
}));

// Photos arrive as data: URIs, so the limit can't be tiny — but 10mb per
// request was generous enough to be a cheap denial-of-service.
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Minimal request log: method, path, status, duration. No bodies, no tokens.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

app.get('/health', async (_req, res) => {
  const dbOk = await ping();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/sightings', sightingsRoutes);
app.use('/api/statistics', statisticsRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }
  if (typeof err?.message === 'string' && err.message.includes('is not allowed')) {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  respondWithError(res, err);
});

async function start() {
  try {
    await initDatabase();
  } catch (err: any) {
    console.error('Database initialisation failed:', err.message);
    process.exit(1);
  }

  const server = app.listen(config.PORT, () => {
    console.log(`Find Them India API listening on port ${config.PORT} (${config.NODE_ENV})`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(', ')}`);
    if (!config.emailEnabled) console.log('Email disabled (BREVO_API_KEY not set)');
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    // Don't hang forever on open connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
}

start();

export default app;
