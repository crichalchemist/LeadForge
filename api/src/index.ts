import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import authRoutes from './routes/auth';
import businessRoutes from './routes/businesses';
import leadRoutes from './routes/leads';
import pipelineRoutes from './routes/pipeline';
import outreachRoutes from './routes/outreach';
import grantRoutes from './routes/grants';
import reportRoutes from './routes/reports';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
}));

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/businesses', businessRoutes);
app.route('/api/leads', leadRoutes);
app.route('/api/pipeline', pipelineRoutes);
app.route('/api/outreach', outreachRoutes);
app.route('/api/grants', grantRoutes);
app.route('/api/reports', reportRoutes);

export default app;
