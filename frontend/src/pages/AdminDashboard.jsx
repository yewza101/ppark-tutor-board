import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Trash2, UserPlus, KeyRound, ExternalLink, LogOut, ShieldAlert, Users, Database, AlertTriangle } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';

const AdminDashboard = () => {
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  
  // Register Teacher states
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherCode, setNewTeacherCode] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeBoards, setActiveBoards] = useState([]);
  const [isClearing, setIsClearing] = useState(false);
  
  const { user, token, logout } = useAuthStore();
  const navigate = useNavigate();

  const isMasterAdmin = user?.username === 'adminpark' || user?.isMasterAdmin;

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }
    fetchStudents();
    if (isMasterAdmin) {
      fetchTeachers();
    }
    
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
    const interval = setInterval(fetchActiveBoards, 12000);
    return () => clearInterval(interval);
  }, [user, navigate, token, isMasterAdmin]);

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

  const fetchTeachers = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/teachers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTeachers(res.data || []);
    } catch (err) {
      console.error('Failed to fetch teachers', err);
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

  const handleRegisterTeacher = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await axios.post(`${API_URL}/api/admin/register-teacher`, 
        { username: newTeacherName, teacher_code: newTeacherCode },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(`Teacher ${newTeacherName} added successfully!`);
      setNewTeacherName('');
      setNewTeacherCode('');
      if (isMasterAdmin) {
        fetchTeachers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to register teacher');
    }
  };

  const handleDeleteTeacher = async (teacherId, teacherUsername) => {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบบัญชีคุณครู "${teacherUsername}"?`)) return;
    try {
      await axios.delete(`${API_URL}/api/admin/teachers/${teacherId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess(`ลบบัญชีคุณครู ${teacherUsername} เรียบร้อยแล้ว`);
      fetchTeachers();
    } catch (err) {
      alert('ไม่สามารถลบบัญชีครูได้: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleClearAllDocuments = async () => {
    const confirmation = prompt('คำเตือนความปลอดภัย:\nคุณกำลังจะลบรูปภาพ, PDF, และลายเส้นบนกระดานทั้งหมด เพื่อคืนพื้นที่จัดเก็บ\n(บัญชีของครูและนักเรียนจะไม่ถูกลบ)\n\nพิมพ์ "CONFIRM" เพื่อยืนยันการลบ:');
    if (confirmation !== 'CONFIRM') {
      alert('ยกเลิกการดำเนินการเรียบร้อยแล้ว');
      return;
    }
    
    setIsClearing(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post(`${API_URL}/api/admin/clear-all-documents`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const msg = res.data?.message || 'ลบแคชและเอกสารทั้งหมดเรียบร้อยแล้ว';
      alert(msg);
      setSuccess(msg);
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการล้างข้อมูล: ' + (err.response?.data?.message || err.message));
      setError('เกิดข้อผิดพลาดในการล้างข้อมูล');
    } finally {
      setIsClearing(false);
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
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
            {isMasterAdmin && (
              <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold border border-amber-300 flex items-center gap-1.5 shadow-sm">
                <ShieldAlert size={14} /> Master Admin (adminpark)
              </span>
            )}
            <button
              onClick={() => navigate('/board/teacher_board')}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium"
            >
              เข้าบอร์ดของครู (Teacher Board)
            </button>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors px-3 py-2 rounded-lg hover:bg-red-50"
          >
            <LogOut size={20} /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {error && <div className="p-4 mb-6 text-sm text-red-700 bg-red-50 rounded-xl border border-red-200 shadow-sm">{error}</div>}
        {success && <div className="p-4 mb-6 text-sm text-green-700 bg-green-50 rounded-xl border border-green-200 shadow-sm">{success}</div>}

        <div className="grid md:grid-cols-3 gap-8">
          
          {/* Left Column: Forms and System Actions */}
          <div className="md:col-span-1 space-y-8">
            
            {/* Add Student Form */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <UserPlus className="text-blue-600" /> Add New Student
              </h2>
              
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
                  className="w-full px-4 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors font-medium shadow-sm"
                >
                  Create Student
                </button>
              </form>
            </div>

            {/* Add Teacher Form */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <UserPlus className="text-indigo-600" /> Add New Teacher
              </h2>
              
              <form onSubmit={handleRegisterTeacher} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Name</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                    value={newTeacherName}
                    onChange={(e) => setNewTeacherName(e.target.value)}
                    placeholder="e.g. Teacher Bob"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Code</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                    value={newTeacherCode}
                    onChange={(e) => setNewTeacherCode(e.target.value)}
                    placeholder="e.g. BOB-1234"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2.5 text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition-colors font-medium shadow-sm"
                >
                  Create Teacher
                </button>
              </form>
            </div>

            {/* Master Admin: Storage Cleanup */}
            {isMasterAdmin && (
              <div className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-2xl border border-red-200 shadow-sm">
                <h2 className="text-lg font-bold text-red-900 mb-2 flex items-center gap-2">
                  <Database className="text-red-600" size={20} /> ล้างพื้นที่จัดเก็บ / แคชกระดาน
                </h2>
                <p className="text-xs text-red-700 mb-4 leading-relaxed">
                  ลบเอกสาร PDF, รูปภาพ และลายเส้นทั้งหมดบนกระดานเพื่อแก้ปัญหาพื้นที่เต็ม
                  <br />
                  <strong className="text-red-900">หมายเหตุ:</strong> บัญชีคุณครูและนักเรียนทั้งหมดจะไม่ถูกลบ
                </p>
                <button
                  onClick={handleClearAllDocuments}
                  disabled={isClearing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 active:bg-red-800 transition-colors font-medium shadow-sm disabled:opacity-50 text-sm"
                >
                  <AlertTriangle size={18} />
                  {isClearing ? 'กำลังล้างข้อมูล...' : 'ลบเอกสารและแคชกระดานทั้งหมด'}
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Student Groups & Teacher Management */}
          <div className="md:col-span-2 space-y-8">
            
            {/* Master Admin: Teacher Management Table */}
            {isMasterAdmin && (
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                    <Users className="text-indigo-600" /> จัดการบัญชีคุณครู ({teachers.length})
                  </h2>
                </div>
                
                {teachers.length === 0 ? (
                  <div className="py-6 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    ยังไม่มีบัญชีครูอื่นในระบบ
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="py-3 px-4 text-sm font-semibold text-gray-600">ชื่อครู (Username)</th>
                          <th className="py-3 px-4 text-sm font-semibold text-gray-600">รหัสเข้าใช้งาน (Code)</th>
                          <th className="py-3 px-4 text-sm font-semibold text-gray-600">วันที่สร้าง</th>
                          <th className="py-3 px-4 text-sm font-semibold text-gray-600 text-right">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teachers.map((t) => (
                          <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-4 font-medium text-gray-800">{t.username}</td>
                            <td className="py-3 px-4 text-sm font-mono text-indigo-600 font-semibold">{t.teacher_code || '-'}</td>
                            <td className="py-3 px-4 text-sm text-gray-500">
                              {t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => handleDeleteTeacher(t.id, t.username)}
                                title="ลบบัญชีครู"
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center gap-1 text-sm font-medium"
                              >
                                <Trash2 size={16} /> ลบ
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Student Groups */}
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
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigate('/board/teacher_board_' + encodeURIComponent(groupName))}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-sm font-medium transition-colors"
                          >
                            Teacher Board
                          </button>
                          <button
                            onClick={() => navigate(`/monitor/${encodeURIComponent(groupName)}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition-colors"
                          >
                            <ExternalLink size={16} /> Monitor Group
                          </button>
                        </div>
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
