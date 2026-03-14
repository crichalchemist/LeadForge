import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import GrantPipeline from './pages/GrantPipeline';
import GrantDetail from './pages/GrantDetail';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Reports from './pages/Reports';

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/grants" element={<GrantPipeline />} />
        <Route path="/grants/:id" element={<GrantDetail />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/reports" element={<Reports />} />
      </Routes>
    </AppLayout>
  );
}
