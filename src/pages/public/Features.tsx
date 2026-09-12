import { Link } from 'react-router-dom';
import { Calendar, Video, CreditCard, Users, FileText, ArrowRight, CheckCircle, Shield, Zap, BarChart } from 'lucide-react';

export default function Features() {
  return (
    <div className="bg-[var(--cs-bg)]">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-[var(--cs-text)] text-[var(--cs-bg)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-32 text-center">
          <div className="inline-flex items-center space-x-2 bg-[var(--cs-bg)]/10 rounded-full px-4 py-2 w-fit mb-8 border border-[var(--cs-bg)]/20">
            <span className="text-[var(--cs-accent-hover)] font-semibold text-sm tracking-wide uppercase">For Educators</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight mb-6">
            The Ultimate <span className="text-[var(--cs-accent-hover)]">Tutor Business Suite</span>
          </h1>
          <p className="mt-4 text-xl text-[var(--cs-bg)]/70 max-w-3xl mx-auto mb-10 leading-relaxed">
            Stop juggling spreadsheets, payment apps, and calendar links. ClassStackr consolidates your entire tutoring business into one powerful, automated platform.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-6">
            <Link to="/login" className="w-full sm:w-auto px-8 py-4 bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)] flex items-center justify-center">
              Start Your Free Trial
              <ArrowRight className="ml-2 w-5 h-5" strokeWidth={1.75} />
            </Link>
            <Link to="/pricing" className="w-full sm:w-auto px-8 py-4 bg-transparent text-[var(--cs-bg)] border border-[var(--cs-bg)]/20 rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-bg)]/10 flex items-center justify-center">
              View Pricing
            </Link>
          </div>
        </div>
      </div>

      {/* Core Features Grid */}
      <div className="py-24 bg-[var(--cs-bg)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-4xl font-semibold text-[var(--cs-text)] mb-4">Everything You Need to Scale</h2>
            <p className="text-xl text-[var(--cs-text-muted)] max-w-2xl mx-auto">
              Focus on teaching. We handle the admin, billing, and scheduling.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
            {/* Feature 1 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <Calendar className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Smart Scheduling</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Set your availability and let students book directly. Automated email and SMS reminders drastically reduce no-shows.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Google Calendar Sync</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Timezone Management</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Buffer Times Between Classes</span></li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <CreditCard className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Automated Billing</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Generate professional invoices instantly. Accept credit cards globally with AES-256 encrypted payment processing.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Recurring Subscriptions</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Automated Receipts</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Late Payment Reminders</span></li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <Users className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Batch Management</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Easily organize and manage group classes. Track attendance, share materials, and communicate with entire cohorts at once.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Group Messaging</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Bulk File Sharing</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Capacity Limits & Waitlists</span></li>
              </ul>
            </div>

            {/* Feature 4 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <Video className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Virtual Classrooms</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Seamless integration with Google Meet and Zoom. Links are automatically generated and sent to students upon booking.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">One-Click Join</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Secure Access Links</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Session Recording Management</span></li>
              </ul>
            </div>

            {/* Feature 5 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <FileText className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Resource Hub</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Upload and organize study materials, assignments, and past papers. Control access based on student enrollment.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Cloud Storage Included</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Assignment Tracking</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Secure File Sharing</span></li>
              </ul>
            </div>

            {/* Feature 6 */}
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
              <div className="w-14 h-14 bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-container)] flex items-center justify-center mb-6">
                <BarChart className="w-7 h-7 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Business Analytics</h3>
              <p className="mb-6 text-[var(--cs-text-muted)]">
                Gain insights into your tutoring business. Track revenue, student retention, and popular class times.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Revenue Dashboards</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Attendance Reports</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-2 shrink-0" strokeWidth={1.75} /><span className="text-sm text-[var(--cs-text-muted)]">Student Progress Tracking</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div className="py-24 bg-[var(--cs-text)] text-[var(--cs-bg)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="w-16 h-16 bg-[var(--cs-bg)]/10 rounded-[var(--cs-radius-container)] flex items-center justify-center mb-8 border border-[var(--cs-bg)]/20">
                <Shield className="w-8 h-8 text-[var(--cs-accent-hover)]" strokeWidth={1.75} />
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold mb-6">Enterprise-Grade Security for Your Business</h2>
              <p className="text-lg text-[var(--cs-bg)]/70 mb-8 leading-relaxed">
                We take data protection seriously. Your business data, student information, and financial transactions are secured with industry-leading protocols.
              </p>
              <ul className="space-y-6">
                <li className="flex">
                  <div className="flex-shrink-0 mt-1">
                    <Zap className="w-6 h-6 text-[var(--cs-accent-hover)]" strokeWidth={1.75} />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-lg font-semibold">AES-256 Encryption</h4>
                    <p className="text-[var(--cs-bg)]/60 mt-1">All sensitive data, including API keys and tokens, are encrypted at rest.</p>
                  </div>
                </li>
                <li className="flex">
                  <div className="flex-shrink-0 mt-1">
                    <Shield className="w-6 h-6 text-[var(--cs-accent-hover)]" strokeWidth={1.75} />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-lg font-semibold">Secure Authentication</h4>
                    <p className="text-[var(--cs-bg)]/60 mt-1">Multi-factor authentication and secure session management protect your account.</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="bg-[var(--cs-bg)]/10 rounded-[var(--cs-radius-container)] p-8 border border-[var(--cs-bg)]/20">
              <h3 className="text-xl font-semibold mb-6 border-b border-[var(--cs-bg)]/20 pb-4">Data Privacy Guarantee</h3>
              <p className="text-[var(--cs-bg)]/70 mb-6">
                You own your data. We never sell student information or your business metrics to third parties. Our platform is fully compliant with global privacy standards.
              </p>
              <div className="flex items-center space-x-4">
                <div className="bg-[var(--cs-text)] px-4 py-2 rounded-[var(--cs-radius-control)] border border-[var(--cs-bg)]/20 text-sm font-medium text-[var(--cs-bg)]/70">GDPR Compliant</div>
                <div className="bg-[var(--cs-text)] px-4 py-2 rounded-[var(--cs-radius-control)] border border-[var(--cs-bg)]/20 text-sm font-medium text-[var(--cs-bg)]/70">CCPA Ready</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-24 bg-[var(--cs-accent)] text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-semibold text-[var(--cs-accent-contrast)] mb-8">Ready to professionalize your tutoring business?</h2>
          <Link to="/login" className="inline-flex items-center px-8 py-4 bg-[var(--cs-accent-contrast)] text-[var(--cs-accent)] rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-soft)]">
            Create Your Free Account
            <ArrowRight className="ml-2 w-5 h-5" strokeWidth={1.75} />
          </Link>
          <p className="mt-6 text-[var(--cs-accent-contrast)]/80">No credit card required. 14-day free trial on premium features.</p>
        </div>
      </div>
    </div>
  );
}
