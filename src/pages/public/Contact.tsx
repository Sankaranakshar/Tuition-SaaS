import React, { useState } from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'tutor'
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Demo requested:', formData);
    alert('Thank you! We will contact you shortly to schedule your demo.');
    setFormData({ name: '', email: '', phone: '', role: 'tutor' });
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-24">
      {/* Header */}
      <section className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight mb-6">
            See how it works
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Request a personalized demo and discover how we can help grow your tuition business.
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-16 max-w-5xl mx-auto">
            
            {/* Demo Form */}
            <div className="bg-white p-8 md:p-10 rounded-3xl shadow-xl border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-8">Request a Demo</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-gray-50"
                    placeholder="John Doe"
                  />
                </div>
                
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-gray-50"
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-gray-50"
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                
                <div>
                  <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
                    I am a...
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-gray-50"
                  >
                    <option value="tutor">Independent Tutor</option>
                    <option value="center">Tuition Center Owner</option>
                    <option value="parent">Parent / Student</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                
                <button
                  type="submit"
                  className="w-full px-8 py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-md flex items-center justify-center mt-8"
                >
                  <Send className="w-5 h-5 mr-2" />
                  Request Demo
                </button>
              </form>
            </div>

            {/* Contact Info */}
            <div className="flex flex-col justify-center space-y-12">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-6">Get in touch</h2>
                <p className="text-lg text-gray-600 mb-8">
                  Have questions before booking a demo? Our team is here to help you find the best solution for your tuition business.
                </p>
                
                <div className="space-y-6">
                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <Mail className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Email Us</h3>
                      <p className="text-gray-600 mt-1">support@example.com</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <Phone className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Call Us</h3>
                      <p className="text-gray-600 mt-1">+1 234 567 890</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <MapPin className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Visit Us</h3>
                      <p className="text-gray-600 mt-1">123 Education St<br/>Learning City, LC 12345</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-indigo-900 rounded-3xl p-8 text-white">
                <h3 className="text-xl font-bold mb-3">Ready to start immediately?</h3>
                <p className="text-indigo-200 mb-6">Skip the demo and start your 14-day free trial right now.</p>
                <a href="/login" className="inline-block px-6 py-3 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition-colors">
                  Start Free Trial
                </a>
              </div>
            </div>

          </div>
        </div>
      </section>
    </div>
  );
}
