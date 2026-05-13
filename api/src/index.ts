import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import authRoutes from './routes/auth';
import businessRoutes from './routes/businesses';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/businesses', businessRoutes);

export default app;
