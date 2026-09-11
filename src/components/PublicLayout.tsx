import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GraduationCap, Menu, X } from 'lucide-react';

const NAV_BUTTON_PRIMARY =
  "rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] px-6 py-2.5 font-semibold text-[var(--cs-accent-contrast)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)]";

export default function PublicLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navLinks = [
    { name: 'How It Works', path: '/how-it-works' },
    { name: 'For Tutors', path: '/features' },
    { name: 'Pricing', path: '/pricing' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[var(--cs-bg)] font-sans text-[var(--cs-text)]">
      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-20 items-center justify-between">
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2">
                <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] p-2">
                  <GraduationCap className="h-6 w-6 text-[var(--cs-accent-contrast)]" strokeWidth={1.75} />
                </div>
                <span className="text-xl font-semibold tracking-tight text-[var(--cs-text)]">ClassStackr</span>
              </Link>
            </div>

            <nav className="hidden space-x-8 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className={`text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ${
                    location.pathname === link.path
                      ? 'text-[var(--cs-accent)]'
                      : 'text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </nav>

            <div className="hidden items-center space-x-4 border-l border-[var(--cs-border)] pl-8 md:flex">
              {user ? (
                <button onClick={() => navigate('/app')} className={NAV_BUTTON_PRIMARY}>
                  Go to Dashboard
                </button>
              ) : (
                <>
                  <Link to="/login" className="text-sm font-semibold text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-accent)]">
                    Log in
                  </Link>
                  <Link to="/login" className={NAV_BUTTON_PRIMARY}>
                    Sign up
                  </Link>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="rounded-[var(--cs-radius-control)] p-2 text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-text)] focus:outline-none"
              >
                {isMenuOpen ? <X className="h-6 w-6" strokeWidth={1.75} /> : <Menu className="h-6 w-6" strokeWidth={1.75} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="absolute w-full border-t border-[var(--cs-border)] bg-[var(--cs-surface)] md:hidden">
            <div className="space-y-1 px-4 pb-6 pt-2">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className="block border-b border-[var(--cs-border)] px-3 py-4 text-sm font-medium text-[var(--cs-text)]"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.name}
                </Link>
              ))}
              <div className="flex flex-col space-y-3 px-3 pt-6">
                {user ? (
                  <button
                    onClick={() => { navigate('/app'); setIsMenuOpen(false); }}
                    className="w-full rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] py-3 text-center font-semibold text-[var(--cs-accent-contrast)]"
                  >
                    Go to Dashboard
                  </button>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] py-3 text-center font-semibold text-[var(--cs-text)]"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Log in
                    </Link>
                    <Link
                      to="/login"
                      className="w-full rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] py-3 text-center font-semibold text-[var(--cs-accent-contrast)]"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-grow">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-[var(--cs-text)] py-16 text-[var(--cs-bg)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
            <div className="col-span-1 md:col-span-1">
              <div className="mb-6 flex items-center">
                <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] p-2">
                  <GraduationCap className="h-6 w-6 text-[var(--cs-accent-contrast)]" strokeWidth={1.75} />
                </div>
                <span className="ml-3 text-xl font-semibold tracking-tight">ClassStackr</span>
              </div>
              <p className="text-sm leading-relaxed text-[var(--cs-bg)]/70">
                The premier destination for finding verified tutors and managing your educational business.
              </p>
            </div>
            <div>
              <h3 className="mb-6 text-sm font-semibold">For Learners</h3>
              <ul className="space-y-4 text-[var(--cs-bg)]/70">
                <li><Link to="/how-it-works" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">How It Works</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-6 text-sm font-semibold">For Tutors</h3>
              <ul className="space-y-4 text-[var(--cs-bg)]/70">
                <li><Link to="/features" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Tutor Suite</Link></li>
                <li><Link to="/pricing" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Pricing</Link></li>
                <li><Link to="/login" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Apply to Teach</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-6 text-sm font-semibold">Company</h3>
              <ul className="space-y-4 text-[var(--cs-bg)]/70">
                <li><a href="#" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">About Us</a></li>
                <li><Link to="/how-it-works" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Contact</Link></li>
                <li><a href="#" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Privacy Policy</a></li>
                <li><a href="#" className="transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-bg)]">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-16 border-t border-[var(--cs-bg)]/20 pt-8 text-center text-sm text-[var(--cs-bg)]/60">
            <p>&copy; {new Date().getFullYear()} ClassStackr. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
