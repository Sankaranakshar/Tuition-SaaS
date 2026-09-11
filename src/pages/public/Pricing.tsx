import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, X, ArrowRight, HelpCircle } from 'lucide-react';

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');

  return (
    <div className="bg-[var(--cs-surface-2)] min-h-screen">
      {/* Hero Section */}
      <div className="bg-[var(--cs-bg)] pt-24 pb-16 border-b border-[var(--cs-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-semibold text-[var(--cs-text)] mb-6">Transparent Pricing for Tutors</h1>
          <p className="text-xl text-[var(--cs-text-muted)] max-w-3xl mx-auto mb-10">
            Start for free, upgrade when you need more power. No hidden fees, ever.
          </p>

          <div className="flex justify-center items-center space-x-4">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-[var(--cs-text)]' : 'text-[var(--cs-text-muted)]'}`}>Monthly</span>
            <button
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              className="relative inline-flex h-8 w-16 items-center rounded-full bg-[var(--cs-accent)] transition-colors duration-[var(--cs-motion-fast)] focus:outline-none"
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-[var(--cs-accent-contrast)] transition-transform duration-[var(--cs-motion-fast)] ${billingCycle === 'annual' ? 'translate-x-9' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-medium flex items-center ${billingCycle === 'annual' ? 'text-[var(--cs-text)]' : 'text-[var(--cs-text-muted)]'}`}>
              Annually <span className="ml-2 bg-[var(--cs-accent-soft)] text-[var(--cs-accent)] text-xs px-2 py-0.5 rounded-full font-semibold">Save 20%</span>
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 -mt-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {/* Basic Tier */}
          <div className="bg-[var(--cs-surface)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] p-8 flex flex-col">
            <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-2">Starter</h3>
            <p className="text-[var(--cs-text-muted)] mb-6">Perfect for new tutors building their client base.</p>
            <div className="mb-8">
              <span className="text-4xl font-semibold text-[var(--cs-text)]">$0</span>
              <span className="text-[var(--cs-text-muted)]">/month</span>
            </div>
            <Link to="/login" className="w-full py-3 px-4 bg-[var(--cs-accent-soft)] text-[var(--cs-accent)] font-semibold rounded-[var(--cs-radius-control)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent)] hover:text-[var(--cs-accent-contrast)] text-center mb-8">
              Get Started Free
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-[var(--cs-text)] mb-4">What's included:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Public Tutor Profile</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Up to 5 Active Students</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Basic Scheduling</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Standard Support</span></li>
                <li className="flex items-start opacity-50"><X className="w-5 h-5 text-[var(--cs-text-faint)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Group Batches</span></li>
                <li className="flex items-start opacity-50"><X className="w-5 h-5 text-[var(--cs-text-faint)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Automated Invoicing</span></li>
              </ul>
            </div>
          </div>

          {/* Pro Tier */}
          <div className="bg-[var(--cs-accent)] rounded-[var(--cs-radius-container)] border border-[var(--cs-accent-hover)] p-8 flex flex-col relative transform md:-translate-y-4">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[var(--cs-text)] text-[var(--cs-bg)] px-4 py-1 rounded-full text-sm font-semibold">
              Most Popular
            </div>
            <h3 className="text-2xl font-semibold text-[var(--cs-accent-contrast)] mb-2">Professional</h3>
            <p className="text-[var(--cs-accent-contrast)]/80 mb-6">Everything you need to run a full-time tutoring business.</p>
            <div className="mb-8">
              <span className="text-4xl font-semibold text-[var(--cs-accent-contrast)]">${billingCycle === 'annual' ? '29' : '39'}</span>
              <span className="text-[var(--cs-accent-contrast)]/80">/month</span>
              {billingCycle === 'annual' && <div className="text-sm text-[var(--cs-accent-contrast)]/80 mt-1">Billed $348 annually</div>}
            </div>
            <Link to="/login" className="w-full py-3 px-4 bg-[var(--cs-accent-contrast)] text-[var(--cs-accent)] font-semibold rounded-[var(--cs-radius-control)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-soft)] text-center mb-8">
              Start 14-Day Free Trial
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-[var(--cs-accent-contrast)] mb-4">Everything in Starter, plus:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent-contrast)]/80 mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-accent-contrast)]">Unlimited Students</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent-contrast)]/80 mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-accent-contrast)]">Group Batch Management</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent-contrast)]/80 mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-accent-contrast)]">Automated Invoicing & Payments</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent-contrast)]/80 mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-accent-contrast)]">Google Meet / Zoom Integration</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent-contrast)]/80 mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-accent-contrast)]">Priority Support</span></li>
              </ul>
            </div>
          </div>

          {/* Enterprise Tier */}
          <div className="bg-[var(--cs-surface)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] p-8 flex flex-col">
            <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-2">Coaching Center</h3>
            <p className="text-[var(--cs-text-muted)] mb-6">For multi-tutor organizations and learning centers.</p>
            <div className="mb-8">
              <span className="text-4xl font-semibold text-[var(--cs-text)]">${billingCycle === 'annual' ? '99' : '129'}</span>
              <span className="text-[var(--cs-text-muted)]">/month</span>
              {billingCycle === 'annual' && <div className="text-sm text-[var(--cs-text-muted)] mt-1">Billed $1,188 annually</div>}
            </div>
            <Link to="/contact" className="w-full py-3 px-4 bg-[var(--cs-text)] text-[var(--cs-bg)] font-semibold rounded-[var(--cs-radius-control)] transition-colors duration-[var(--cs-motion-fast)] hover:opacity-90 text-center mb-8">
              Contact Sales
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-[var(--cs-text)] mb-4">Everything in Pro, plus:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Up to 10 Tutor Accounts</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Centralized Admin Dashboard</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Custom Branding (White-label)</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Advanced Analytics & Reporting</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mr-3 shrink-0" strokeWidth={1.75} /><span className="text-[var(--cs-text-muted)]">Dedicated Account Manager</span></li>
              </ul>
            </div>
          </div>

        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-semibold text-center text-[var(--cs-text)] mb-12">Detailed Feature Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="py-4 px-6 bg-[var(--cs-surface-2)] font-semibold text-[var(--cs-text)] border-b border-[var(--cs-border)] w-1/3">Features</th>
                <th className="py-4 px-6 bg-[var(--cs-surface-2)] font-semibold text-[var(--cs-text)] border-b border-[var(--cs-border)] text-center w-1/5">Starter</th>
                <th className="py-4 px-6 bg-[var(--cs-accent-soft)] font-semibold text-[var(--cs-accent)] border-b border-[var(--cs-accent-soft)] text-center w-1/5">Professional</th>
                <th className="py-4 px-6 bg-[var(--cs-surface-2)] font-semibold text-[var(--cs-text)] border-b border-[var(--cs-border)] text-center w-1/5">Coaching Center</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">Public Profile Listing</td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">Active Students</td>
                <td className="py-4 px-6 text-center text-[var(--cs-text-muted)]">Up to 5</td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40 font-semibold text-[var(--cs-accent)]">Unlimited</td>
                <td className="py-4 px-6 text-center text-[var(--cs-text-muted)]">Unlimited</td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">1-on-1 Scheduling</td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">Group Batch Management</td>
                <td className="py-4 px-6 text-center"><X className="w-5 h-5 text-[var(--cs-text-faint)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">Automated Invoicing</td>
                <td className="py-4 px-6 text-center"><X className="w-5 h-5 text-[var(--cs-text-faint)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-[var(--cs-accent)] mx-auto" strokeWidth={1.75} /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-[var(--cs-text-muted)]">Platform Fee per Transaction</td>
                <td className="py-4 px-6 text-center text-[var(--cs-text-muted)]">5%</td>
                <td className="py-4 px-6 text-center bg-[var(--cs-accent-soft)]/40 font-semibold text-[var(--cs-accent)]">0%</td>
                <td className="py-4 px-6 text-center text-[var(--cs-text-muted)]">0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-[var(--cs-bg)] py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold text-[var(--cs-text)]">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-6">
            {[
              {
                q: "Is there a free trial for the Professional plan?",
                a: "Yes! You can try the Professional plan completely free for 14 days. No credit card is required to start your trial."
              },
              {
                q: "What happens to my data if I downgrade to Starter?",
                a: "Your data is safe. However, if you have more than 5 active students, you will need to select which 5 remain active, or upgrade back to Professional to manage them all."
              },
              {
                q: "Are there any hidden fees?",
                a: "No. The Professional and Coaching Center plans have 0% platform fees. Standard Stripe/payment gateway processing fees (usually 2.9% + 30¢) still apply to transactions."
              },
              {
                q: "Can I switch from monthly to annual billing later?",
                a: "Absolutely. You can change your billing cycle at any time from your account settings. Upgrading to annual billing will immediately apply the 20% discount."
              }
            ].map((faq, idx) => (
              <div key={idx} className="bg-[var(--cs-surface-2)] rounded-[var(--cs-radius-control)] p-6 border border-[var(--cs-border)]">
                <h4 className="text-lg font-semibold text-[var(--cs-text)] flex items-start">
                  <HelpCircle className="w-6 h-6 text-[var(--cs-accent)] mr-3 shrink-0 mt-0.5" strokeWidth={1.75} />
                  {faq.q}
                </h4>
                <p className="text-[var(--cs-text-muted)] mt-3 ml-9">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-[var(--cs-accent)] text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-semibold text-[var(--cs-accent-contrast)] mb-8">Still have questions?</h2>
          <Link to="/how-it-works" className="inline-flex items-center px-8 py-4 bg-[var(--cs-accent-contrast)] text-[var(--cs-accent)] rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-soft)]">
            Contact Our Team
            <ArrowRight className="ml-2 w-5 h-5" strokeWidth={1.75} />
          </Link>
        </div>
      </div>
    </div>
  );
}
