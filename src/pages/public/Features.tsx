import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Video, CreditCard, Users, FileText, MessageSquare, ArrowRight, CheckCircle, Shield, Zap, BarChart } from 'lucide-react';

export default function Features() {
  return (
    <div className="bg-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-32 text-center">
          <div className="inline-flex items-center space-x-2 bg-indigo-500/20 rounded-full px-4 py-2 w-fit mb-8 border border-indigo-500/30">
            <span className="text-indigo-300 font-semibold text-sm tracking-wide uppercase">For Educators</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6">
            The Ultimate <span className="text-indigo-400">Tutor Business Suite</span>
          </h1>
          <p className="mt-4 text-xl text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed">
            Stop juggling spreadsheets, payment apps, and calendar links. ClassStackr consolidates your entire tutoring business into one powerful, automated platform.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <Link to="/login" className="w-full sm:w-auto px-8 py-4 bg-indigo-600 text-white rounded-full font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-900/50 flex items-center justify-center">
              Start Your Free Trial
              <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
            <Link to="/pricing" className="w-full sm:w-auto px-8 py-4 bg-transparent text-white border border-gray-600 rounded-full font-bold text-lg hover:bg-gray-800 transition-colors flex items-center justify-center">
              View Pricing
            </Link>
          </div>
        </div>
      </div>

      {/* Core Features Grid */}
      <div className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Everything You Need to Scale</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Focus on teaching. We handle the admin, billing, and scheduling.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
            {/* Feature 1 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                <Calendar className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Smart Scheduling</h3>
              <p className="text-gray-600 mb-6">
                Set your availability and let students book directly. Automated email and SMS reminders drastically reduce no-shows.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Google Calendar Sync</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Timezone Management</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Buffer Times Between Classes</span></li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-emerald-100 rounded-xl flex items-center justify-center mb-6">
                <CreditCard className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Automated Billing</h3>
              <p className="text-gray-600 mb-6">
                Generate professional invoices instantly. Accept credit cards globally with AES-256 encrypted payment processing.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Recurring Subscriptions</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Automated Receipts</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Late Payment Reminders</span></li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center mb-6">
                <Users className="w-7 h-7 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Batch Management</h3>
              <p className="text-gray-600 mb-6">
                Easily organize and manage group classes. Track attendance, share materials, and communicate with entire cohorts at once.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Group Messaging</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Bulk File Sharing</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Capacity Limits & Waitlists</span></li>
              </ul>
            </div>

            {/* Feature 4 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
                <Video className="w-7 h-7 text-orange-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Virtual Classrooms</h3>
              <p className="text-gray-600 mb-6">
                Seamless integration with Google Meet and Zoom. Links are automatically generated and sent to students upon booking.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">One-Click Join</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Secure Access Links</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Session Recording Management</span></li>
              </ul>
            </div>

            {/* Feature 5 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-pink-100 rounded-xl flex items-center justify-center mb-6">
                <FileText className="w-7 h-7 text-pink-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Resource Hub</h3>
              <p className="text-gray-600 mb-6">
                Upload and organize study materials, assignments, and past papers. Control access based on student enrollment.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Cloud Storage Included</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Assignment Tracking</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Secure File Sharing</span></li>
              </ul>
            </div>

            {/* Feature 6 */}
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-14 h-14 bg-teal-100 rounded-xl flex items-center justify-center mb-6">
                <BarChart className="w-7 h-7 text-teal-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Business Analytics</h3>
              <p className="text-gray-600 mb-6">
                Gain insights into your tutoring business. Track revenue, student retention, and popular class times.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Revenue Dashboards</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Attendance Reports</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-2 shrink-0" /><span className="text-sm text-gray-700">Student Progress Tracking</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-8 border border-slate-700">
                <Shield className="w-8 h-8 text-indigo-400" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">Enterprise-Grade Security for Your Business</h2>
              <p className="text-lg text-slate-300 mb-8 leading-relaxed">
                We take data protection seriously. Your business data, student information, and financial transactions are secured with industry-leading protocols.
              </p>
              <ul className="space-y-6">
                <li className="flex">
                  <div className="flex-shrink-0 mt-1">
                    <Zap className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-lg font-semibold">AES-256 Encryption</h4>
                    <p className="text-slate-400 mt-1">All sensitive data, including API keys and tokens, are encrypted at rest.</p>
                  </div>
                </li>
                <li className="flex">
                  <div className="flex-shrink-0 mt-1">
                    <Shield className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-lg font-semibold">Secure Authentication</h4>
                    <p className="text-slate-400 mt-1">Multi-factor authentication and secure session management protect your account.</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl">
              <h3 className="text-xl font-bold mb-6 border-b border-slate-700 pb-4">Data Privacy Guarantee</h3>
              <p className="text-slate-300 mb-6">
                You own your data. We never sell student information or your business metrics to third parties. Our platform is fully compliant with global privacy standards.
              </p>
              <div className="flex items-center space-x-4">
                <div className="bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 text-sm font-medium text-slate-300">GDPR Compliant</div>
                <div className="bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 text-sm font-medium text-slate-300">CCPA Ready</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-24 bg-indigo-600 text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-extrabold text-white mb-8">Ready to professionalize your tutoring business?</h2>
          <Link to="/login" className="inline-flex items-center px-8 py-4 bg-white text-indigo-600 rounded-full font-bold text-lg hover:bg-gray-50 transition-colors shadow-xl">
            Create Your Free Account
            <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
          <p className="mt-6 text-indigo-200">No credit card required. 14-day free trial on premium features.</p>
        </div>
      </div>
    </div>
  );
}
