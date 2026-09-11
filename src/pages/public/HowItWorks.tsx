import { ShieldCheck, Search, CalendarCheck, Award, CheckCircle, Video, MessageSquare, Star } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HowItWorks() {
  return (
    <div className="bg-[var(--cs-bg)]">
      {/* Hero Section */}
      <div className="bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-semibold mb-6">How ClassStackr Works</h1>
          <p className="text-xl text-[var(--cs-accent-contrast)]/80 max-w-3xl mx-auto">
            Your journey to academic success is just a few clicks away. We've built a secure, transparent platform to connect you with the world's best educators.
          </p>
        </div>
      </div>

      {/* The Learner Journey */}
      <div className="py-24 bg-[var(--cs-bg)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-semibold text-[var(--cs-text)]">3 Steps to Better Grades</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Connecting Line (Desktop) */}
            <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-0.5 bg-[var(--cs-border)] z-0"></div>

            <div className="relative z-10 text-center">
              <div className="w-24 h-24 bg-[var(--cs-surface)] border-4 border-[var(--cs-accent-soft)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-10 h-10 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-4">1. Find Your Match</h3>
              <p className="text-[var(--cs-text-muted)] text-lg">
                Browse our marketplace or take the Tutor Match Quiz. Filter by subject, grade level, format (1-on-1 or group), and budget.
              </p>
            </div>

            <div className="relative z-10 text-center">
              <div className="w-24 h-24 bg-[var(--cs-surface)] border-4 border-[var(--cs-accent-soft)] rounded-full flex items-center justify-center mx-auto mb-6">
                <CalendarCheck className="w-10 h-10 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-4">2. Book & Connect</h3>
              <p className="text-[var(--cs-text-muted)] text-lg">
                Schedule a session that fits your calendar. Message the tutor directly to discuss your specific goals before the class begins.
              </p>
            </div>

            <div className="relative z-10 text-center">
              <div className="w-24 h-24 bg-[var(--cs-surface)] border-4 border-[var(--cs-accent-soft)] rounded-full flex items-center justify-center mx-auto mb-6">
                <Award className="w-10 h-10 text-[var(--cs-accent)]" strokeWidth={1.75} />
              </div>
              <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-4">3. Learn & Succeed</h3>
              <p className="text-[var(--cs-text-muted)] text-lg">
                Join the secure virtual classroom. Access shared materials, track your progress, and watch your confidence grow.
              </p>
            </div>
          </div>

          <div className="mt-16 text-center">
            <Link to="/contact" className="inline-flex items-center px-8 py-4 bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] rounded-[var(--cs-radius-control)] font-semibold text-lg transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)]">
              Start Searching Now
            </Link>
          </div>
        </div>
      </div>

      {/* Trust & Safety Deep Dive */}
      <div className="py-24 bg-[var(--cs-surface-2)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-semibold text-[var(--cs-text)] mb-6">Uncompromising Safety & Quality</h2>
              <p className="text-lg text-[var(--cs-text-muted)] mb-8">
                We don't let just anyone teach on ClassStackr. Our acceptance rate is less than 15% because we prioritize your safety and educational outcomes above all else.
              </p>

              <div className="space-y-6">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <ShieldCheck className="w-8 h-8 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-xl font-semibold text-[var(--cs-text)]">Background Checks</h4>
                    <p className="text-[var(--cs-text-muted)] mt-1">Every tutor undergoes a comprehensive identity and criminal background check before their profile goes live.</p>
                  </div>
                </div>

                <div className="flex">
                  <div className="flex-shrink-0">
                    <CheckCircle className="w-8 h-8 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-xl font-semibold text-[var(--cs-text)]">Credential Verification</h4>
                    <p className="text-[var(--cs-text-muted)] mt-1">We manually verify university degrees, teaching certificates, and professional qualifications.</p>
                  </div>
                </div>

                <div className="flex">
                  <div className="flex-shrink-0">
                    <Video className="w-8 h-8 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <div className="ml-4">
                    <h4 className="text-xl font-semibold text-[var(--cs-text)]">Secure Classrooms</h4>
                    <p className="text-[var(--cs-text-muted)] mt-1">All sessions are hosted on secure, encrypted video links. Communication stays on-platform to protect your privacy.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-[var(--cs-accent)] rounded-[var(--cs-radius-container)] transform translate-x-4 translate-y-4 opacity-10"></div>
              <div className="bg-[var(--cs-surface)] rounded-[var(--cs-radius-container)] p-8 relative z-10 border border-[var(--cs-border)]">
                <h3 className="text-2xl font-semibold text-[var(--cs-text)] mb-6">The ClassStackr Guarantee</h3>
                <p className="text-[var(--cs-text-muted)] mb-6">
                  If you're not completely satisfied with your first session with a new tutor, we'll refund your money or match you with someone else for free.
                </p>
                <div className="bg-[var(--cs-accent-soft)] rounded-[var(--cs-radius-control)] p-6">
                  <div className="flex items-center mb-4">
                    <MessageSquare className="w-6 h-6 text-[var(--cs-accent)] mr-3" strokeWidth={1.75} />
                    <span className="font-semibold text-[var(--cs-accent)]">24/7 Support Team</span>
                  </div>
                  <p className="text-sm text-[var(--cs-accent)]/80">
                    Our dedicated support team is always available to help resolve any issues, answer questions, or assist with billing.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Success Stories */}
      <div className="py-24 bg-[var(--cs-bg)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-semibold text-[var(--cs-text)]">Learner Success Stories</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                name: "Sarah T.",
                role: "High School Senior",
                quote: "I was struggling with AP Calculus, but my ClassStackr tutor broke it down perfectly. I ended up getting a 5 on the exam!",
                image: "https://i.pravatar.cc/150?img=44"
              },
              {
                name: "Mark & Lisa",
                role: "Parents of 8th Grader",
                quote: "The group batches are fantastic. Our son loves learning coding with other kids, and it's much more affordable than we expected.",
                image: "https://i.pravatar.cc/150?img=33"
              },
              {
                name: "James L.",
                role: "College Student",
                quote: "I needed last-minute help before my Organic Chemistry final. Found a verified expert within an hour. Lifesaver.",
                image: "https://i.pravatar.cc/150?img=12"
              }
            ].map((testimonial, idx) => (
              <div key={idx} className="bg-[var(--cs-surface-2)] rounded-[var(--cs-radius-container)] p-8 border border-[var(--cs-border)]">
                <div className="flex items-center space-x-1 mb-6">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 text-[var(--cs-accent)] fill-current" />)}
                </div>
                <p className="text-[var(--cs-text-muted)] text-lg italic mb-8">"{testimonial.quote}"</p>
                <div className="flex items-center">
                  <img src={testimonial.image} alt={testimonial.name} className="w-12 h-12 rounded-full mr-4" />
                  <div>
                    <h4 className="font-semibold text-[var(--cs-text)]">{testimonial.name}</h4>
                    <p className="text-sm text-[var(--cs-text-muted)]">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
