import 'dotenv/config';   // ← must be first — loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db/database';
import authRoutes from './routes/auth';
import casesRoutes from './routes/cases';
import sightingsRoutes from './routes/sightings';
import statisticsRoutes from './routes/statistics';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Find Them India API is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/sightings', sightingsRoutes);
app.use('/api/statistics', statisticsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

// Start server after DB init
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`\n🚀 Find Them India Backend running on http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`\n📋 Available APIs:`);
      console.log(`   POST   /api/auth/login`);
      console.log(`   POST   /api/auth/register`);
      console.log(`   GET    /api/auth/me`);
      console.log(`   GET    /api/cases`);
      console.log(`   POST   /api/cases`);
      console.log(`   GET    /api/cases/:id`);
      console.log(`   PATCH  /api/cases/:id/status`);
      console.log(`   GET    /api/sightings`);
      console.log(`   POST   /api/sightings`);
      console.log(`   GET    /api/statistics`);
      console.log(`   GET    /api/statistics/alerts`);
      console.log(`\n🔑 Demo: demo@findthemindia.app / demo1234`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();