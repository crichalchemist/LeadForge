import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import LegacySurface from './components/layout/LegacySurface';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import GrantPipeline from './pages/GrantPipeline';
import GrantDetail from './pages/GrantDetail';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Reports from './pages/Reports';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/leads" replace />} />
                <Route path="/dashboard" element={<LegacySurface><Dashboard /></LegacySurface>} />
                <Route path="/pipeline" element={<LegacySurface><Pipeline /></LegacySurface>} />
                <Route path="/grants" element={<LegacySurface><GrantPipeline /></LegacySurface>} />
                <Route path="/grants/:id" element={<LegacySurface><GrantDetail /></LegacySurface>} />
                <Route path="/leads" element={<LegacySurface><Leads /></LegacySurface>} />
                <Route path="/leads/:id" element={<LegacySurface><LeadDetail /></LegacySurface>} />
                <Route path="/reports" element={<LegacySurface><Reports /></LegacySurface>} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
