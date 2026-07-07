import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users, User, Shield } from 'lucide-react';

export default function RoleSelection() {
  const { user, setCurrentRole } = useAuth();
  const navigate = useNavigate();

  if (!user || !user.roles || user.roles.length === 0) {
    return <div className="flex h-screen items-center justify-center">Loading roles...</div>;
  }

  const handleRoleSelect = (role: string) => {
    setCurrentRole(role);
    navigate('/app');
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'student': return <GraduationCap className="w-8 h-8 text-indigo-600" />;
      case 'parent': return <Users className="w-8 h-8 text-green-600" />;
      case 'tutor': return <User className="w-8 h-8 text-blue-600" />;
      case 'admin': return <Shield className="w-8 h-8 text-red-600" />;
      default: return <User className="w-8 h-8 text-gray-600" />;
    }
  };

  const getRoleTitle = (role: string) => {
    return role.charAt(0).toUpperCase() + role.slice(1) + ' Portal';
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'student': return 'Access your classes, assignments, and grades.';
      case 'parent': return 'Monitor progress, manage payments, and communicate.';
      case 'tutor': return 'Manage your students, schedule, and classes.';
      case 'admin': return 'Manage the organization and settings.';
      default: return 'Access your portal.';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Select Your Portal
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          You have multiple roles. Please choose which portal you want to access.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="space-y-4">
            {user.roles.map((role) => (
              <button
                key={role}
                onClick={() => handleRoleSelect(role)}
                className="w-full flex items-center p-4 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-indigo-500 transition-colors text-left"
              >
                <div className="flex-shrink-0 mr-4">
                  {getRoleIcon(role)}
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{getRoleTitle(role)}</h3>
                  <p className="text-sm text-gray-500">{getRoleDescription(role)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
