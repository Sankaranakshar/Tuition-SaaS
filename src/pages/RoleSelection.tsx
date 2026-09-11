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
      case 'student': return <GraduationCap className="h-6 w-6" strokeWidth={1.75} />;
      case 'parent': return <Users className="h-6 w-6" strokeWidth={1.75} />;
      case 'tutor': return <User className="h-6 w-6" strokeWidth={1.75} />;
      case 'admin': return <Shield className="h-6 w-6" strokeWidth={1.75} />;
      default: return <User className="h-6 w-6" strokeWidth={1.75} />;
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
    <div className="flex min-h-screen flex-col justify-center bg-[var(--cs-bg)] py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">
          Select your portal
        </h2>
        <p className="mt-2 text-center text-sm text-[var(--cs-text-muted)]">
          You have multiple roles. Please choose which portal you want to access.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] px-4 py-8 sm:px-10">
          <div className="space-y-4">
            {user.roles.map((role) => (
              <button
                key={role}
                onClick={() => handleRoleSelect(role)}
                className="flex w-full items-center rounded-[var(--cs-radius-container)] border-2 border-[var(--cs-border)] p-4 text-left transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:border-[var(--cs-accent)] hover:bg-[var(--cs-accent-soft)]"
              >
                <div className="mr-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]">
                  {getRoleIcon(role)}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--cs-text)]">{getRoleTitle(role)}</h3>
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
