import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors({ origin: '*', credentials: true }));
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
