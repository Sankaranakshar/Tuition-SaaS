import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Users, User, Shield } from 'lucide-react';

export default function RoleSelection() {
  const { user, setCurrentRole } = useAuth();
  const navigate = useNavigate();

  if (!user || !user.roles || user.roles.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--cs-text-muted)]">
        Loading roles...
      </div>
    );
  }

  const handleRoleSelect = (role: string) => {
    setCurrentRole(role);
    navigate('/app');
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'student': return <GraduationCap className="w-8 h-8 text-[var(--cs-accent)]" />;
      case 'parent': return <Users className="w-8 h-8 text-[var(--cs-ok)]" />;
      case 'tutor': return <User className="w-8 h-8 text-[var(--cs-warn)]" />;
      case 'admin': return <Shield className="w-8 h-8 text-[var(--cs-danger)]" />;
      default: return <User className="w-8 h-8 text-[var(--cs-text-muted)]" />;
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
    <div className="min-h-screen bg-[var(--cs-bg)] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-[var(--cs-text)]">
          Select Your Portal
        </h2>
        <p className="mt-2 text-center text-sm text-[var(--cs-text-muted)]">
          You have multiple roles. Please choose which portal you want to access.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[var(--cs-surface)] py-8 px-4 border border-[var(--cs-border)] rounded-[10px] sm:px-10">
          <div className="space-y-4">
            {user.roles.map((role) => (
              <button
                key={role}
                onClick={() => handleRoleSelect(role)}
                className="w-full flex items-center p-4 border border-[var(--cs-border)] rounded-[6px] hover:bg-[var(--cs-bg)] hover:border-[var(--cs-accent)] transition-colors text-left"
              >
                <div className="flex-shrink-0 mr-4">
                  {getRoleIcon(role)}
                </div>
                <div>
                  <h3 className="text-lg font-medium text-[var(--cs-text)]">{getRoleTitle(role)}</h3>
                  <p className="text-sm text-[var(--cs-text-muted)]">{getRoleDescription(role)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
