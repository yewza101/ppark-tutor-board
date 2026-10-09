import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.ppark-tutor.com';

const TeacherShortcutBar = ({ currentBoardId }) => {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [activeBoards, setActiveBoards] = useState([]);
  
  if (user?.role !== 'admin') return null;

  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        const [studentsRes, activeRes] = await Promise.all([
          axios.get(`${API_URL}/api/admin/students`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/api/admin/active-boards`, { headers: { Authorization: `Bearer ${token}` } })
        ]);
        
        if (isMounted) {
          setStudents(studentsRes.data || []);
          setActiveBoards(activeRes.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch shortcut data', err);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token]);

  let currentGroup = 'General';
  if (currentBoardId.startsWith('teacher_board_')) {
     currentGroup = decodeURIComponent(currentBoardId.replace('teacher_board_', ''));
  } else {
     const st = students.find(s => String(s.id) === currentBoardId);
     if (st && st.group_name) currentGroup = st.group_name;
  }

  // Show active students of the current group
  const activeStudents = students.filter(s => activeBoards.includes(String(s.id)) && (s.group_name || 'General') === currentGroup);

  return (
    <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur shadow-[0_-4px_10px_-1px_rgba(0,0,0,0.1)] rounded-t-xl px-4 py-2.5 flex items-center gap-2 overflow-x-auto max-w-[90vw] z-[100] border border-gray-200 hide-scrollbar transition-all hover:bg-white">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-2 whitespace-nowrap">
            {currentGroup}
        </span>
        <button
            onClick={() => navigate(`/board/teacher_board_${encodeURIComponent(currentGroup)}`)}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex items-center gap-2 ${
                currentBoardId === `teacher_board_${currentGroup}` 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
        >
            Teacher Board
        </button>
        
        <div className="w-px h-6 bg-gray-300 mx-1"></div>
        
        {activeStudents.length === 0 && (
            <span className="text-sm text-gray-400 italic whitespace-nowrap px-2">No students online</span>
        )}
        
        {activeStudents.map(student => {
            const sid = String(student.id);
            const isCurrent = currentBoardId === sid;
            return (
                <button
                    key={sid}
                    onClick={() => navigate(`/board/${sid}`)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                        isCurrent 
                        ? 'bg-blue-600 text-white shadow-md scale-105' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:scale-105'
                    }`}
                >
                    <span className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-white' : 'bg-green-500 animate-pulse'}`}></span>
                    {student.name}
                </button>
            );
        })}
    </div>
  );
};

export default TeacherShortcutBar;
