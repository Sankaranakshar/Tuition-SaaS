import { useState, useEffect } from "react";
import { Bell, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Notifications() {
  const { user } = useAuth();
  
  // Mock notifications for now
  const notifications = [
    { id: 1, type: 'alert', title: 'New Assignment', message: 'Math Homework 4 has been assigned.', date: new Date().toISOString(), read: false },
    { id: 2, type: 'warning', title: 'Low Wallet Balance', message: 'Your wallet balance is below $20. Please top up.', date: new Date(Date.now() - 86400000).toISOString(), read: false },
    { id: 3, type: 'info', title: 'Class Rescheduled', message: 'Physics class has been moved to 4 PM tomorrow.', date: new Date(Date.now() - 172800000).toISOString(), read: true },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <button className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
          Mark all as read
        </button>
      </div>

      <div className="bg-white shadow-sm rounded-xl border border-gray-100 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {notifications.map((notification) => (
            <li key={notification.id} className={`p-4 hover:bg-gray-50 transition-colors ${!notification.read ? 'bg-indigo-50/30' : ''}`}>
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-1">
                  {notification.type === 'alert' && <Bell className="w-5 h-5 text-indigo-500" />}
                  {notification.type === 'warning' && <AlertTriangle className="w-5 h-5 text-orange-500" />}
                  {notification.type === 'info' && <Info className="w-5 h-5 text-blue-500" />}
                  {notification.type === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
                </div>
                <div className="ml-3 flex-1">
                  <p className={`text-sm font-medium ${!notification.read ? 'text-gray-900' : 'text-gray-700'}`}>
                    {notification.title}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">{notification.message}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(notification.date).toLocaleDateString()} • {new Date(notification.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </p>
                </div>
                {!notification.read && (
                  <div className="ml-3 flex-shrink-0">
                    <span className="h-2 w-2 bg-indigo-600 rounded-full inline-block"></span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
