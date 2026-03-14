import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Attach Bearer token on every request
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Deduplicated refresh on 401
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshToken()
          .then((token) => {
            refreshPromise = null;
            return token;
          })
          .catch((err) => {
            refreshPromise = null;
            setAccessToken(null);
            window.location.href = '/login';
            return Promise.reject(err);
          });
      }

      const token = await refreshPromise;
      setAccessToken(token);
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    }
    return Promise.reject(error);
  },
);

export default api;

// ── Auth API ─────────────────────────────────

export async function loginUser(email: string, password: string) {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

export async function refreshToken(): Promise<string> {
  const res = await api.post('/auth/refresh');
  return res.data.access_token;
}

export async function logoutUser() {
  await api.post('/auth/logout');
}

export async function fetchMe() {
  const res = await api.get('/auth/me');
  return res.data;
}

// ── Businesses ───────────────────────────────

export const fetchBusinesses = (params: Record<string, string | number>) =>
  api.get('/businesses', { params }).then((r) => r.data);

export const fetchBusiness = (id: string) =>
  api.get(`/businesses/${id}`).then((r) => r.data);

export const updateBusiness = (id: string, data: Record<string, unknown>) =>
  api.patch(`/businesses/${id}`, data).then((r) => r.data);

// ── Leads ────────────────────────────────────

export const fetchRankedLeads = (params: Record<string, string | number>) =>
  api.get('/leads/ranked', { params }).then((r) => r.data);

export const fetchScoreHistory = (businessId: string) =>
  api.get(`/leads/${businessId}/score`).then((r) => r.data);

// ── Pipeline ─────────────────────────────────

export const fetchPipelineBoard = () =>
  api.get('/pipeline/board').then((r) => r.data);

export const transitionStage = (outreachId: string, newStage: string) =>
  api.patch(`/pipeline/${outreachId}/stage`, { new_stage: newStage }).then((r) => r.data);

// ── Outreach ─────────────────────────────────

export const fetchOutreachHistory = (businessId: string) =>
  api.get(`/outreach/by-business/${businessId}`).then((r) => r.data);

export const fetchOutreach = (id: string) =>
  api.get(`/outreach/${id}`).then((r) => r.data);

export const fetchTranscript = (id: string) =>
  api.get(`/outreach/${id}/transcript`).then((r) => r.data);

export const updateOutreach = (id: string, data: Record<string, unknown>) =>
  api.patch(`/outreach/${id}`, data).then((r) => r.data);

// ── Reports ──────────────────────────────────

export const fetchFunnel = () =>
  api.get('/reports/funnel').then((r) => r.data);

export const fetchScoreDistribution = () =>
  api.get('/reports/score-distribution').then((r) => r.data);

export const fetchZipPerformance = () =>
  api.get('/reports/zip-performance').then((r) => r.data);

// ── Grants ───────────────────────────────────

export const fetchGrantBoard = () =>
  api.get('/grants/board').then((r) => r.data);

export const fetchGrants = (params: Record<string, string | number>) =>
  api.get('/grants', { params }).then((r) => r.data);

export const fetchGrant = (id: string) =>
  api.get(`/grants/${id}`).then((r) => r.data);

export const createGrant = (data: { business_id: string; total_project_cost?: number; acquisition_cost?: number; project_description?: string }) =>
  api.post('/grants', data).then((r) => r.data);

export const updateGrant = (id: string, data: Record<string, unknown>) =>
  api.patch(`/grants/${id}`, data).then((r) => r.data);

export const transitionGrantStage = (grantId: string, newStage: string) =>
  api.patch(`/grants/${grantId}/stage`, { new_stage: newStage }).then((r) => r.data);

export const fetchGrantDocuments = (grantId: string) =>
  api.get(`/grants/${grantId}/documents`).then((r) => r.data);

export const updateGrantDocument = (grantId: string, docId: string, data: Record<string, unknown>) =>
  api.patch(`/grants/${grantId}/documents/${docId}`, data).then((r) => r.data);

export const fetchGrantFinancials = (grantId: string) =>
  api.get(`/grants/financials/${grantId}`).then((r) => r.data);
