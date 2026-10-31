import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import Board from './pages/Board';
import GroupMonitor from './pages/GroupMonitor';
import GlobalVoiceWidget from './components/GlobalVoiceWidget';

import useAuthStore from './store/useAuthStore';

function VoiceWrapper() {
  const location = useLocation();
  const { user } = useAuthStore();
  if (!user || location.search.includes('readonly=true')) return null;
  return <GlobalVoiceWidget />;
}

// The routes used to render for anyone who typed the URL; only the API calls failed.
// Guard them so an unauthenticated visitor never sees the dashboard shell at all.
function RequireAuth({ children, role }) {
  const { user, token } = useAuthStore();
  const location = useLocation();
  if (!user || !token) return <Navigate to="/login" replace state={{ from: location }} />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : `/board/${user.id}`} replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <VoiceWrapper />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
        <Route path="/board/:studentId" element={<RequireAuth><Board /></RequireAuth>} />
        <Route path="/monitor/:groupName" element={<RequireAuth role="admin"><GroupMonitor /></RequireAuth>} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
