import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, X, ArrowRight, HelpCircle } from 'lucide-react';

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero Section */}
      <div className="bg-white pt-24 pb-16 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-6">Transparent Pricing for Tutors</h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-10">
            Start for free, upgrade when you need more power. No hidden fees, ever.
          </p>
          
          <div className="flex justify-center items-center space-x-4">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-gray-900' : 'text-gray-500'}`}>Monthly</span>
            <button 
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              className="relative inline-flex h-8 w-16 items-center rounded-full bg-indigo-600 transition-colors focus:outline-none"
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${billingCycle === 'annual' ? 'translate-x-9' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-medium flex items-center ${billingCycle === 'annual' ? 'text-gray-900' : 'text-gray-500'}`}>
              Annually <span className="ml-2 bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full font-bold">Save 20%</span>
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 -mt-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Basic Tier */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8 flex flex-col">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Starter</h3>
            <p className="text-gray-500 mb-6">Perfect for new tutors building their client base.</p>
            <div className="mb-8">
              <span className="text-4xl font-extrabold text-gray-900">$0</span>
              <span className="text-gray-500">/month</span>
            </div>
            <Link to="/login" className="w-full py-3 px-4 bg-indigo-50 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 transition-colors text-center mb-8">
              Get Started Free
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-gray-900 mb-4">What's included:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Public Tutor Profile</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Up to 5 Active Students</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Basic Scheduling</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Standard Support</span></li>
                <li className="flex items-start opacity-50"><X className="w-5 h-5 text-gray-400 mr-3 shrink-0" /><span className="text-gray-500">Group Batches</span></li>
                <li className="flex items-start opacity-50"><X className="w-5 h-5 text-gray-400 mr-3 shrink-0" /><span className="text-gray-500">Automated Invoicing</span></li>
              </ul>
            </div>
          </div>

          {/* Pro Tier */}
          <div className="bg-indigo-600 rounded-3xl shadow-xl border border-indigo-500 p-8 flex flex-col relative transform md:-translate-y-4">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-pink-500 to-orange-400 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
              Most Popular
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Professional</h3>
            <p className="text-indigo-200 mb-6">Everything you need to run a full-time tutoring business.</p>
            <div className="mb-8">
              <span className="text-4xl font-extrabold text-white">${billingCycle === 'annual' ? '29' : '39'}</span>
              <span className="text-indigo-200">/month</span>
              {billingCycle === 'annual' && <div className="text-sm text-indigo-200 mt-1">Billed $348 annually</div>}
            </div>
            <Link to="/login" className="w-full py-3 px-4 bg-white text-indigo-600 font-bold rounded-xl hover:bg-gray-50 transition-colors text-center mb-8 shadow-md">
              Start 14-Day Free Trial
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-white mb-4">Everything in Starter, plus:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-indigo-300 mr-3 shrink-0" /><span className="text-white">Unlimited Students</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-indigo-300 mr-3 shrink-0" /><span className="text-white">Group Batch Management</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-indigo-300 mr-3 shrink-0" /><span className="text-white">Automated Invoicing & Payments</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-indigo-300 mr-3 shrink-0" /><span className="text-white">Google Meet / Zoom Integration</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-indigo-300 mr-3 shrink-0" /><span className="text-white">Priority Support</span></li>
              </ul>
            </div>
          </div>

          {/* Enterprise Tier */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8 flex flex-col">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Coaching Center</h3>
            <p className="text-gray-500 mb-6">For multi-tutor organizations and learning centers.</p>
            <div className="mb-8">
              <span className="text-4xl font-extrabold text-gray-900">${billingCycle === 'annual' ? '99' : '129'}</span>
              <span className="text-gray-500">/month</span>
              {billingCycle === 'annual' && <div className="text-sm text-gray-500 mt-1">Billed $1,188 annually</div>}
            </div>
            <Link to="/contact" className="w-full py-3 px-4 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors text-center mb-8">
              Contact Sales
            </Link>
            <div className="flex-grow">
              <p className="font-semibold text-gray-900 mb-4">Everything in Pro, plus:</p>
              <ul className="space-y-4">
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Up to 10 Tutor Accounts</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Centralized Admin Dashboard</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Custom Branding (White-label)</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Advanced Analytics & Reporting</span></li>
                <li className="flex items-start"><CheckCircle className="w-5 h-5 text-green-500 mr-3 shrink-0" /><span className="text-gray-600">Dedicated Account Manager</span></li>
              </ul>
            </div>
          </div>

        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Detailed Feature Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="py-4 px-6 bg-gray-50 font-bold text-gray-900 border-b border-gray-200 w-1/3">Features</th>
                <th className="py-4 px-6 bg-gray-50 font-bold text-gray-900 border-b border-gray-200 text-center w-1/5">Starter</th>
                <th className="py-4 px-6 bg-indigo-50 font-bold text-indigo-900 border-b border-indigo-200 text-center w-1/5">Professional</th>
                <th className="py-4 px-6 bg-gray-50 font-bold text-gray-900 border-b border-gray-200 text-center w-1/5">Coaching Center</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="py-4 px-6 text-gray-700">Public Profile Listing</td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center bg-indigo-50/30"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-gray-700">Active Students</td>
                <td className="py-4 px-6 text-center text-gray-600">Up to 5</td>
                <td className="py-4 px-6 text-center bg-indigo-50/30 font-semibold text-indigo-700">Unlimited</td>
                <td className="py-4 px-6 text-center text-gray-600">Unlimited</td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-gray-700">1-on-1 Scheduling</td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center bg-indigo-50/30"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-gray-700">Group Batch Management</td>
                <td className="py-4 px-6 text-center"><X className="w-5 h-5 text-gray-300 mx-auto" /></td>
                <td className="py-4 px-6 text-center bg-indigo-50/30"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-gray-700">Automated Invoicing</td>
                <td className="py-4 px-6 text-center"><X className="w-5 h-5 text-gray-300 mx-auto" /></td>
                <td className="py-4 px-6 text-center bg-indigo-50/30"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
                <td className="py-4 px-6 text-center"><CheckCircle className="w-5 h-5 text-green-500 mx-auto" /></td>
              </tr>
              <tr>
                <td className="py-4 px-6 text-gray-700">Platform Fee per Transaction</td>
                <td className="py-4 px-6 text-center text-gray-600">5%</td>
                <td className="py-4 px-6 text-center bg-indigo-50/30 font-semibold text-indigo-700">0%</td>
                <td className="py-4 px-6 text-center text-gray-600">0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900">Frequently Asked Questions</h2>
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
              <div key={idx} className="bg-gray-50 rounded-xl p-6 border border-gray-100">
                <h4 className="text-lg font-bold text-gray-900 flex items-start">
                  <HelpCircle className="w-6 h-6 text-indigo-600 mr-3 shrink-0 mt-0.5" />
                  {faq.q}
                </h4>
                <p className="text-gray-600 mt-3 ml-9">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-indigo-600 text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white mb-8">Still have questions?</h2>
          <Link to="/how-it-works" className="inline-flex items-center px-8 py-4 bg-white text-indigo-600 rounded-full font-bold text-lg hover:bg-gray-50 transition-colors shadow-lg">
            Contact Our Team
            <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
