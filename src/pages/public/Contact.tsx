import React, { useState } from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';

const FIELD_CLASS =
  "w-full px-4 py-3 border border-[var(--cs-border-strong)] rounded-[var(--cs-radius-control)] outline-none focus:ring-2 focus:ring-[var(--cs-focus)]/30 focus:border-[var(--cs-focus)] transition-colors duration-[var(--cs-motion-fast)] bg-[var(--cs-surface-2)]";

export default function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'tutor'
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormData({ name: '', email: '', phone: '', role: 'tutor' });
  };

  return (
    <div className="bg-[var(--cs-surface-2)] min-h-screen pb-24">
      {/* Header */}
      <section className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-semibold text-[var(--cs-text)] tracking-tight mb-6">
            See how it works
          </h1>
          <p className="text-xl text-[var(--cs-text-muted)] max-w-3xl mx-auto">
            Request a personalized demo and discover how we can help grow your tuition business.
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-16 max-w-5xl mx-auto">

            {/* Demo Form */}
            <div className="bg-[var(--cs-surface)] p-8 md:p-10 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)]">
              <h2 className="text-2xl font-semibold text-[var(--cs-text)] mb-8">Request a Demo</h2>
              {submitted && (
              <div className="mb-6 rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] px-4 py-3 text-sm text-[var(--cs-accent)]">
                Thank you! We will contact you shortly to schedule your demo.
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-[var(--cs-text-muted)] mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className={FIELD_CLASS}
                    placeholder="John Doe"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[var(--cs-text-muted)] mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className={FIELD_CLASS}
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-[var(--cs-text-muted)] mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    className={FIELD_CLASS}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>

                <div>
                  <label htmlFor="role" className="block text-sm font-medium text-[var(--cs-text-muted)] mb-2">
                    I am a...
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className={FIELD_CLASS}
                  >
                    <option value="tutor">Independent Tutor</option>
                    <option value="center">Tuition Center Owner</option>
                    <option value="parent">Parent / Student</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full px-8 py-4 bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)] flex items-center justify-center mt-8"
                >
                  <Send className="w-5 h-5 mr-2" strokeWidth={1.75} />
                  Request Demo
                </button>
              </form>
            </div>

            {/* Contact Info */}
            <div className="flex flex-col justify-center space-y-12">
              <div>
                <h2 className="text-3xl font-semibold text-[var(--cs-text)] mb-6">Get in touch</h2>
                <p className="text-lg text-[var(--cs-text-muted)] mb-8">
                  Have questions before booking a demo? Our team is here to help you find the best solution for your tuition business.
                </p>

                <div className="space-y-6">
                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-[var(--cs-accent-soft)] rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <Mail className="w-6 h-6 text-[var(--cs-accent)]" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--cs-text)]">Email Us</h3>
                      <p className="text-[var(--cs-text-muted)] mt-1">support@example.com</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-[var(--cs-accent-soft)] rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <Phone className="w-6 h-6 text-[var(--cs-accent)]" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--cs-text)]">Call Us</h3>
                      <p className="text-[var(--cs-text-muted)] mt-1">+1 234 567 890</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="w-12 h-12 bg-[var(--cs-accent-soft)] rounded-full flex items-center justify-center flex-shrink-0 mr-4">
                      <MapPin className="w-6 h-6 text-[var(--cs-accent)]" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--cs-text)]">Visit Us</h3>
                      <p className="text-[var(--cs-text-muted)] mt-1">123 Education St<br/>Learning City, LC 12345</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--cs-text)] rounded-[var(--cs-radius-container)] p-8 text-[var(--cs-bg)]">
                <h3 className="text-xl font-semibold mb-3">Ready to start immediately?</h3>
                <p className="text-[var(--cs-bg)]/70 mb-6">Skip the demo and start your 14-day free trial right now.</p>
                <a href="/login" className="inline-block px-6 py-3 bg-[var(--cs-bg)] text-[var(--cs-text)] rounded-[var(--cs-radius-control)] font-semibold transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-bg)]/90">
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
