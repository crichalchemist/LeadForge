import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import authRoutes from './routes/auth';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.route('/api/auth', authRoutes);

export default app;
