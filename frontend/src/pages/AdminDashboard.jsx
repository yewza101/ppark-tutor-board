import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Trash2, UserPlus, KeyRound, ExternalLink, LogOut } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';

const AdminDashboard = () => {
  const [students, setStudents] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeBoards, setActiveBoards] = useState([]);
  
  const { user, token, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }
    fetchStudents();
    
    const fetchActiveBoards = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/admin/active-boards`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setActiveBoards(res.data || []);
      } catch (err) {
        // silently fail
      }
    };
    
    fetchActiveBoards();
    const interval = setInterval(fetchActiveBoards, 5000);
    return () => clearInterval(interval);
  }, [user, navigate, token]);

  const fetchStudents = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/students`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStudents(res.data);
    } catch (err) {
      console.error(err);
      if (err.response?.status === 401) {
        logout();
        navigate('/login');
      }
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await axios.post(`${API_URL}/api/admin/students`, 
        { username: newUsername, password: newPassword, group_name: newGroupName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess('Student added successfully!');
      setNewUsername('');
      setNewPassword('');
      setNewGroupName('');
      fetchStudents();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add student');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this student?')) return;
    try {
      await axios.delete(`${API_URL}/api/admin/students/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchStudents();
    } catch (err) {
      alert('Failed to delete student');
    }
  };

  const handleResetPassword = async (id) => {
    const newPass = prompt('Enter new password for this student:');
    if (!newPass) return;
    try {
      await axios.put(`${API_URL}/api/admin/students/${id}/password`, 
        { password: newPass },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Password reset successful');
    } catch (err) {
      alert('Failed to reset password');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans w-full">
      <header className="bg-white shadow-sm sticky top-0 z-10 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors px-3 py-2 rounded-lg hover:bg-red-50"
          >
            <LogOut size={20} /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="grid md:grid-cols-3 gap-8">
          
          {/* Add Student Form */}
          <div className="md:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <UserPlus className="text-blue-600" /> Add New Student
              </h2>
              
              {error && <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">{error}</div>}
              {success && <div className="p-3 mb-4 text-sm text-green-600 bg-green-50 rounded-lg border border-green-100">{success}</div>}
              
              <form onSubmit={handleAddStudent} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="student1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="password123"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group / Class Name</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. Class 1, Math 101"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors font-medium"
                >
                  Create Student
                </button>
              </form>
            </div>
          </div>

          {/* Student List */}
          <div className="md:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold mb-6">Student Groups</h2>
              
              <div className="space-y-8">
                {students.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">No students found</div>
                ) : (
                  Object.entries(
                    students.reduce((acc, student) => {
                      const group = student.group_name || 'General';
                      if (!acc[group]) acc[group] = [];
                      acc[group].push(student);
                      return acc;
                    }, {})
                  ).map(([groupName, groupStudents]) => (
                    <div key={groupName} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                        <div className="font-bold text-gray-700 flex items-center gap-2">
                          {groupName} 
                          <span className="text-sm font-normal text-gray-500">({groupStudents.length} students)</span>
                          {groupStudents.filter(s => activeBoards.includes(String(s.id))).length > 0 && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                              {groupStudents.filter(s => activeBoards.includes(String(s.id))).length} Online
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => navigate(`/monitor/${encodeURIComponent(groupName)}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors"
                        >
                          <ExternalLink size={16} /> Monitor Group
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="py-3 px-4 text-sm font-semibold text-gray-600">Username</th>
                              <th className="py-3 px-4 text-sm font-semibold text-gray-600">Created At</th>
                              <th className="py-3 px-4 text-sm font-semibold text-gray-600 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupStudents.map((student) => (
                              <tr key={student.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                <td className="py-3 px-4 font-medium flex items-center gap-2">
                                  {student.username}
                                  {activeBoards.includes(String(student.id)) && (
                                    <span className="flex items-center justify-center w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" title="Online / Active"></span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-sm text-gray-500">
                                  {new Date(student.created_at).toLocaleDateString()}
                                </td>
                                <td className="py-3 px-4 flex justify-end gap-2">
                                  <button
                                    onClick={() => navigate(`/board/${student.id}`)}
                                    title="Open Board"
                                    className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                                  >
                                    <ExternalLink size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleResetPassword(student.id)}
                                    title="Reset Password"
                                    className="p-2 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors"
                                  >
                                    <KeyRound size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(student.id)}
                                    title="Delete Student"
                                    className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
