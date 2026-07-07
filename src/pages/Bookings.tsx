import { useState } from "react";
import { Calendar, Clock, User, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Bookings() {
  const { user } = useAuth();
  
  // Mock data
  const requests = [
    { id: 1, type: 'reschedule', date: '2023-10-25', time: '14:00', status: 'pending', tutor: 'Sarah Johnson' },
    { id: 2, type: 'booking', date: '2023-10-28', time: '10:00', status: 'approved', tutor: 'Michael Chen' },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Bookings & Requests</h1>
        <button className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors">
          <Plus className="w-4 h-4 mr-2" />
          Book Private Session
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-indigo-500" />
            My Requests
          </h2>
        </div>
        
        <ul className="divide-y divide-gray-100">
          {requests.map((req) => (
            <li key={req.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 mr-4">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 capitalize">{req.type} Request</p>
                  <p className="text-xs text-gray-500 mt-1 flex items-center">
                    <User className="w-3 h-3 mr-1" /> {req.tutor} • {new Date(req.date).toLocaleDateString()} at {req.time}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  req.status === 'approved' ? 'bg-green-100 text-green-800' : 
                  req.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                }`}>
                  {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                </span>
                {req.status === 'pending' && (
                  <button className="text-sm text-red-600 hover:text-red-800 font-medium">Cancel</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
