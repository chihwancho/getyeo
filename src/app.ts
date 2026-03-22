// src/app.ts — Express app (no listen); used by server and tests
import express from 'express';
import 'dotenv/config';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import vacationRoutes from './routes/vacation';
import placesRoutes from './routes/places';

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================================================
// ROUTES
// ============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/vacations', vacationRoutes);
app.use('/api/places', placesRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use(errorHandler);

export { app };