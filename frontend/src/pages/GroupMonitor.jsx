import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Users } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { API_URL } from '../config';
import MiniBoard from '../components/MiniBoard';

const GroupMonitor = () => {
  const { groupName } = useParams();
  const navigate = useNavigate();
  const { user, token, logout } = useAuthStore();
  const [students, setStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Decode the URL param (e.g. "Class%201" -> "Class 1")
  const decodedGroupName = decodeURIComponent(groupName);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }

    const fetchGroupStudents = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/admin/students`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        // Filter students by group name
        // "General" is used if group_name is falsy
        const filtered = res.data.filter(s => {
          const sGroup = s.group_name || 'General';
          return sGroup === decodedGroupName;
        });
        
        setStudents(filtered);
      } catch (err) {
        console.error(err);
        if (err.response?.status === 401) {
          logout();
          navigate('/login');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroupStudents();
  }, [user, token, navigate, logout, decodedGroupName]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-20 w-full">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/admin')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Users className="text-blue-600" />
              Monitor: {decodedGroupName}
            </h1>
          </div>
          
          <div className="text-sm text-gray-500 font-medium">
            {students.length} Student{students.length !== 1 && 's'} Active
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl shadow-sm border border-gray-200">
            <Users size={48} className="text-gray-300 mb-4" />
            <h3 className="text-xl font-bold text-gray-700">No students found</h3>
            <p className="text-gray-500">There are no students in the "{decodedGroupName}" group.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {students.map(student => (
              <MiniBoard 
                key={student.id} 
                student={student} 
                token={token}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default GroupMonitor;
