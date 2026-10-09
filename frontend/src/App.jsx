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

function App() {
  return (
    <Router>
      <VoiceWrapper />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/board/:studentId" element={<Board />} />
        <Route path="/monitor/:groupName" element={<GroupMonitor />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
