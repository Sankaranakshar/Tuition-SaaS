import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { Shield, CheckCircle, XCircle, User as UserIcon } from 'lucide-react';

export default function Admin() {
  const { user } = useAuth();
  const [tutors, setTutors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.organizationId) return;
    fetchTutors();
  }, [user?.organizationId]);

  const fetchTutors = async () => {
    try {
      // The old Firestore query had no org filter at all (a platform-wide
      // view), but there's no cross-org superadmin role anywhere in this
      // app's RLS/role model — every other admin surface is org-scoped, and
      // tutor_profiles' RLS only lets a caller see rows in their own org
      // anyway. Scoping this query to match is a deliberate consistency fix,
      // not a regression: the unscoped query would have silently returned
      // nothing (or errored) against RLS regardless.
      const { data, error } = await supabase
        .from('tutor_profiles')
        .select('*')
        .eq('organization_id', user!.organizationId);
      if (error) throw error;
      setTutors((data || []).map((row) => ({ id: row.user_id, ...row })));
    } catch (err) {
      console.error(err);
      setError('Failed to fetch tutors');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTutor = async (tutorId: string, isVerified: boolean) => {
    try {
      const { error } = await supabase.from('tutor_profiles').update({ is_verified: isVerified }).eq('user_id', tutorId);
      if (error) throw error;
      setTutors(tutors.map(t => t.id === tutorId ? { ...t, is_verified: isVerified } : t));
    } catch (err) {
      console.error(err);
      setError('Failed to update tutor verification status');
    }
  };

  if (user?.role_type !== 'admin' && user?.role !== 'admin') {
    return <div className="p-6 text-center text-red-600">Access Denied. Admin only.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Shield className="w-6 h-6 mr-2 text-indigo-600" />
          Admin Console
        </h1>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Tutor Verification</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Approve or reject tutor profiles.</p>
        </div>
        <ul className="divide-y divide-gray-200">
          {loading ? (
            <li className="px-4 py-4 text-center text-gray-500">Loading tutors...</li>
          ) : tutors.length === 0 ? (
            <li className="px-4 py-4 text-center text-gray-500">No tutors found.</li>
          ) : (
            tutors.map((tutor) => (
              <li key={tutor.id}>
                <div className="px-4 py-4 flex items-center sm:px-6">
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                    <div className="truncate">
                      <div className="flex text-sm">
                        <p className="font-medium text-indigo-600 truncate">{tutor.full_name}</p>
                        <p className="ml-1 flex-shrink-0 font-normal text-gray-500">
                          in {tutor.location || 'Unknown'}
                        </p>
                      </div>
                      <div className="mt-2 flex">
                        <div className="flex items-center text-sm text-gray-500">
                          <UserIcon className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                          <p>
                            {tutor.subjects?.join(', ')} | {tutor.grades?.join(', ')}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                      <div className="flex space-x-2">
                        {tutor.is_verified ? (
                          <button
                            onClick={() => handleVerifyTutor(tutor.id, false)}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-5 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-50 focus:outline-none focus:shadow-outline-red focus:border-red-300 active:bg-red-200 transition duration-150 ease-in-out"
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Revoke
                          </button>
                        ) : (
                          <button
                            onClick={() => handleVerifyTutor(tutor.id, true)}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-5 font-medium rounded-md text-green-700 bg-green-100 hover:bg-green-50 focus:outline-none focus:shadow-outline-green focus:border-green-300 active:bg-green-200 transition duration-150 ease-in-out"
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Verify
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
