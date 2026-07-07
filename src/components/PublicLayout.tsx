import React, { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GraduationCap, Menu, X } from 'lucide-react';

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
    <div className="min-h-screen flex flex-col font-sans text-gray-900 bg-white">
      {/* Navigation Bar */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2">
                <div className="bg-indigo-600 p-2 rounded-lg">
                  <GraduationCap className="w-6 h-6 text-white" />
                </div>
                <span className="text-2xl font-extrabold text-gray-900 tracking-tight">ClassStackr</span>
              </Link>
            </div>
            
            <nav className="hidden md:flex space-x-8">
              {navLinks.map((link) => (
                <Link 
                  key={link.name} 
                  to={link.path} 
                  className={`text-base font-medium transition-colors ${
                    location.pathname === link.path 
                      ? 'text-indigo-600' 
                      : 'text-gray-600 hover:text-indigo-600'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </nav>

            <div className="hidden md:flex items-center space-x-4 border-l pl-8 border-gray-200">
              {user ? (
                <button 
                  onClick={() => navigate('/app')}
                  className="bg-indigo-600 text-white px-6 py-2.5 rounded-full font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Go to Dashboard
                </button>
              ) : (
                <>
                  <Link to="/login" className="text-gray-900 font-semibold hover:text-indigo-600 transition-colors">
                    Log in
                  </Link>
                  <Link 
                    to="/login" 
                    className="bg-indigo-600 text-white px-6 py-2.5 rounded-full font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="text-gray-500 hover:text-gray-900 focus:outline-none p-2"
              >
                {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 absolute w-full shadow-lg">
            <div className="px-4 pt-2 pb-6 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className="block px-3 py-4 text-base font-medium text-gray-900 border-b border-gray-50"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.name}
                </Link>
              ))}
              <div className="pt-6 flex flex-col space-y-3 px-3">
                {user ? (
                  <button 
                    onClick={() => { navigate('/app'); setIsMenuOpen(false); }}
                    className="w-full text-center bg-indigo-600 text-white font-bold py-3 rounded-lg"
                  >
                    Go to Dashboard
                  </button>
                ) : (
                  <>
                    <Link 
                      to="/login" 
                      className="w-full text-center text-gray-900 font-bold py-3 border border-gray-200 rounded-lg"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      Log in
                    </Link>
                    <Link 
                      to="/login" 
                      className="w-full text-center bg-indigo-600 text-white font-bold py-3 rounded-lg"
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
      <footer className="bg-gray-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center mb-6">
                <div className="bg-indigo-500 p-2 rounded-lg">
                  <GraduationCap className="h-6 w-6 text-white" />
                </div>
                <span className="ml-3 text-2xl font-extrabold tracking-tight">ClassStackr</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                The premier destination for finding verified tutors and managing your educational business.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-6">For Learners</h3>
              <ul className="space-y-4 text-gray-400">
                <li><Link to="/how-it-works" className="hover:text-white transition-colors">How It Works</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-6">For Tutors</h3>
              <ul className="space-y-4 text-gray-400">
                <li><Link to="/features" className="hover:text-white transition-colors">Tutor Suite</Link></li>
                <li><Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                <li><Link to="/login" className="hover:text-white transition-colors">Apply to Teach</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-6">Company</h3>
              <ul className="space-y-4 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><Link to="/how-it-works" className="hover:text-white transition-colors">Contact</Link></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-16 pt-8 text-center text-gray-500 text-sm">
            <p>&copy; {new Date().getFullYear()} ClassStackr. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
