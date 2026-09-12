import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, Users, User, BookOpen, ArrowRight, Star, CheckCircle, Calculator, Code, Globe, Beaker } from 'lucide-react';

export default function Home() {
  const [learningFormat, setLearningFormat] = useState<'1on1' | 'group'>('1on1');

  return (
    <div className="bg-[var(--cs-bg)]">
      {/* Hero Section: "Learn Your Way" */}
      <div className="relative overflow-hidden bg-[var(--cs-accent-soft)]">
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-24 text-center sm:px-6 lg:px-8">
          <h1 className="mb-6 text-5xl font-semibold tracking-tight text-[var(--cs-text)] md:text-6xl">
            Master Any Subject with <br className="hidden md:block" />
            <span className="text-[var(--cs-accent)]">1-on-1 Focus or Group Energy.</span>
          </h1>
          <p className="mx-auto mb-10 mt-4 max-w-3xl text-xl text-[var(--cs-text-muted)]">
            Connect with verified experts for personalized attention or collaborative group batches. Find the perfect fit for your learning style and budget.
          </p>

          {/* Massive Search Bar */}
          <div className="mx-auto flex max-w-3xl flex-col items-center rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-2 shadow-[var(--cs-shadow-pop)] sm:flex-row">
            <div className="flex w-full flex-1 items-center border-b border-[var(--cs-border)] px-4 py-2 sm:w-auto sm:border-b-0 sm:border-r">
              <Search className="mr-3 h-5 w-5 text-[var(--cs-text-faint)]" strokeWidth={1.75} />
              <input
                type="text"
                placeholder="What do you want to learn? (e.g. Math, Python)"
                className="w-full bg-transparent text-lg text-[var(--cs-text)] focus:outline-none"
              />
            </div>
            <div className="mt-2 flex w-full flex-1 items-center px-4 py-2 sm:mt-0 sm:w-auto">
              <BookOpen className="mr-3 h-5 w-5 text-[var(--cs-text-faint)]" strokeWidth={1.75} />
              <select className="w-full cursor-pointer appearance-none bg-transparent text-lg text-[var(--cs-text)] focus:outline-none">
                <option value="">Any Grade Level</option>
                <option value="elementary">Elementary School</option>
                <option value="middle">Middle School</option>
                <option value="high">High School</option>
                <option value="college">College / University</option>
                <option value="adult">Adult Learning</option>
              </select>
            </div>
            <Link to="/login" className="mt-2 flex w-full items-center justify-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] px-8 py-4 text-lg font-semibold text-[var(--cs-accent-contrast)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)] sm:mt-0 sm:w-auto">
              Search
            </Link>
          </div>
        </div>
      </div>

      {/* The "Learning Format" Toggle */}
      <div className="bg-[var(--cs-bg)] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--cs-text)] md:text-4xl">Choose Your Learning Format</h2>
            <p className="text-xl text-[var(--cs-text-muted)]">Tailor your educational journey to your specific needs.</p>
          </div>

          <div className="mb-12 flex justify-center">
            <div className="inline-flex rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-1">
              <button
                onClick={() => setLearningFormat('1on1')}
                className={`rounded-[var(--cs-radius-control)] px-8 py-3 text-lg font-semibold transition-colors duration-[var(--cs-motion-fast)] ${
                  learningFormat === '1on1'
                    ? 'bg-[var(--cs-surface)] text-[var(--cs-accent)]'
                    : 'text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]'
                }`}
              >
                1-on-1 Sessions
              </button>
              <button
                onClick={() => setLearningFormat('group')}
                className={`rounded-[var(--cs-radius-control)] px-8 py-3 text-lg font-semibold transition-colors duration-[var(--cs-motion-fast)] ${
                  learningFormat === 'group'
                    ? 'bg-[var(--cs-surface)] text-[var(--cs-accent)]'
                    : 'text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]'
                }`}
              >
                Group Batches
              </button>
            </div>
          </div>

          <div className="mx-auto max-w-4xl">
            {learningFormat === '1on1' ? (
              <div className="flex flex-col items-center gap-8 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 duration-500 animate-in fade-in slide-in-from-bottom-4 md:flex-row md:p-12">
                <div className="flex-1">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[var(--cs-radius-container)] bg-[var(--cs-accent-soft)]">
                    <User className="h-8 w-8 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Personalized Pace & Focus</h3>
                  <ul className="mb-8 space-y-4">
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">100% customized curriculum tailored to your exact needs.</span></li>
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">Flexible scheduling that fits around your busy life.</span></li>
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">Immediate feedback and undivided attention from the tutor.</span></li>
                  </ul>
                  <Link to="/login" className="inline-flex items-center text-lg font-semibold text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]">
                    Find 1-on-1 Tutors <ArrowRight className="ml-2 h-5 w-5" strokeWidth={1.75} />
                  </Link>
                </div>
                <div className="relative w-full flex-1">
                  <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
                    <img src="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&q=80&w=800" alt="1-on-1 Tutoring" className="h-full w-full object-cover opacity-90" />
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-6">
                      <div className="text-white">
                        <p className="text-lg font-semibold">Sarah M.</p>
                        <p className="text-sm opacity-90">Advanced Calculus Session</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-8 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-8 duration-500 animate-in fade-in slide-in-from-bottom-4 md:flex-row md:p-12">
                <div className="flex-1">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[var(--cs-radius-container)] bg-[var(--cs-accent-soft)]">
                    <Users className="h-8 w-8 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <h3 className="mb-4 text-2xl font-semibold text-[var(--cs-text)]">Collaborative & Budget-Friendly</h3>
                  <ul className="mb-8 space-y-4">
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">Learn alongside peers in interactive, small-group settings.</span></li>
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">More affordable rates while maintaining high-quality instruction.</span></li>
                    <li className="flex items-start"><CheckCircle className="mr-3 h-6 w-6 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} /><span className="text-lg text-[var(--cs-text-muted)]">Structured batch schedules for consistent learning routines.</span></li>
                  </ul>
                  <Link to="/login" className="inline-flex items-center text-lg font-semibold text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]">
                    Browse Group Batches <ArrowRight className="ml-2 h-5 w-5" strokeWidth={1.75} />
                  </Link>
                </div>
                <div className="relative w-full flex-1">
                  <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
                    <img src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=800" alt="Group Tutoring" className="h-full w-full object-cover opacity-90" />
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-6">
                      <div className="text-white">
                        <p className="text-lg font-semibold">Python Basics Batch</p>
                        <p className="text-sm opacity-90">5 Students • Starts Next Week</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Browse Top Categories */}
      <div className="bg-[var(--cs-surface-2)] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-semibold text-[var(--cs-text)]">Popular Subjects</h2>
            <p className="text-xl text-[var(--cs-text-muted)]">Find expert tutors in high-demand areas.</p>
          </div>

          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { name: "Mathematics", icon: <Calculator className="h-8 w-8" strokeWidth={1.75} />, count: "1,200+ Tutors" },
              { name: "GCSE Science", icon: <Beaker className="h-8 w-8" strokeWidth={1.75} />, count: "850+ Tutors" },
              { name: "Python Coding", icon: <Code className="h-8 w-8" strokeWidth={1.75} />, count: "500+ Tutors" },
              { name: "Languages", icon: <Globe className="h-8 w-8" strokeWidth={1.75} />, count: "900+ Tutors" }
            ].map((category, idx) => (
              <Link key={idx} to="/login" className="group rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-6 text-center transition-colors duration-[var(--cs-motion-fast)] hover:border-[var(--cs-accent)]">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-[var(--cs-accent)] transition-transform duration-[var(--cs-motion-fast)] group-hover:scale-110">
                  {category.icon}
                </div>
                <h3 className="mb-1 text-lg font-semibold text-[var(--cs-text)]">{category.name}</h3>
                <p className="text-sm text-[var(--cs-text-muted)]">{category.count}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Trust & Safety Spotlight */}
      <div className="bg-[var(--cs-bg)] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[var(--cs-radius-container)] bg-[var(--cs-text)]">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="flex flex-col justify-center p-12 md:p-16">
                <div className="mb-8 inline-flex w-fit items-center space-x-2 rounded-full border border-[var(--cs-bg)]/20 bg-[var(--cs-bg)]/10 px-4 py-2">
                  <ShieldCheck className="h-5 w-5 text-[var(--cs-accent-hover)]" strokeWidth={1.75} />
                  <span className="text-sm font-semibold uppercase tracking-wide text-[var(--cs-accent-hover)]">ClassStackr Verified</span>
                </div>
                <h2 className="mb-6 text-3xl font-semibold text-[var(--cs-bg)] md:text-4xl">Your Safety & Success Are Guaranteed.</h2>
                <p className="mb-8 text-lg leading-relaxed text-[var(--cs-bg)]/70">
                  Every tutor on our platform goes through a rigorous 3-step vetting process before they can host a single session.
                </p>
                <ul className="space-y-6">
                  <li className="flex">
                    <div className="mt-1 shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--cs-bg)]/20 bg-[var(--cs-bg)]/10">
                        <span className="font-semibold text-[var(--cs-bg)]">1</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-[var(--cs-bg)]">Identity Verification</h4>
                      <p className="mt-1 text-[var(--cs-bg)]/60">Government ID and background checks completed.</p>
                    </div>
                  </li>
                  <li className="flex">
                    <div className="mt-1 shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--cs-bg)]/20 bg-[var(--cs-bg)]/10">
                        <span className="font-semibold text-[var(--cs-bg)]">2</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-[var(--cs-bg)]">Academic Credentials</h4>
                      <p className="mt-1 text-[var(--cs-bg)]/60">Degrees and certifications manually verified by our team.</p>
                    </div>
                  </li>
                  <li className="flex">
                    <div className="mt-1 shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--cs-bg)]/20 bg-[var(--cs-bg)]/10">
                        <span className="font-semibold text-[var(--cs-bg)]">3</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-[var(--cs-bg)]">Mock Session Review</h4>
                      <p className="mt-1 text-[var(--cs-bg)]/60">Teaching quality assessed by educational experts.</p>
                    </div>
                  </li>
                </ul>
              </div>
              <div className="relative hidden bg-[var(--cs-text)] lg:block">
                <img
                  src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=1000"
                  alt="Trust and Safety"
                  className="absolute inset-0 h-full w-full object-cover opacity-50 mix-blend-overlay"
                />
                <div className="absolute inset-0 flex items-center justify-center p-12">
                  <div className="w-full max-w-sm rounded-[var(--cs-radius-container)] border border-[var(--cs-bg)]/20 bg-[var(--cs-bg)]/10 p-8 backdrop-blur-md">
                    <div className="mb-6 flex items-center space-x-4">
                      <img src="https://i.pravatar.cc/150?img=32" alt="Tutor" className="h-16 w-16 rounded-full border-2 border-[var(--cs-accent-hover)]" />
                      <div>
                        <h4 className="text-lg font-semibold text-[var(--cs-bg)]">Dr. Emily Chen</h4>
                        <div className="flex items-center text-sm text-[var(--cs-accent-hover)]">
                          <ShieldCheck className="mr-1 h-4 w-4" strokeWidth={1.75} /> Verified Expert
                        </div>
                      </div>
                    </div>
                    <div className="mb-4 flex items-center space-x-1">
                      {[1,2,3,4,5].map(i => <Star key={i} className="h-5 w-5 fill-current text-[var(--cs-accent-hover)]" />)}
                      <span className="ml-2 font-medium text-[var(--cs-bg)]">5.0 (124 reviews)</span>
                    </div>
                    <p className="italic text-[var(--cs-bg)]/80">"Emily helped my son jump two grade levels in Math in just 3 months. Highly recommend!"</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The Professional Pivot (Footer CTA) */}
      <div className="bg-[var(--cs-accent)] py-24 text-center">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="mb-6 text-3xl font-semibold text-[var(--cs-accent-contrast)] md:text-4xl">Are you a Tutor? Automate your business today.</h2>
          <p className="mx-auto mb-10 max-w-2xl text-xl text-[var(--cs-accent-contrast)]/80">
            Stop chasing payments and managing spreadsheets. Get a professional profile, automated scheduling, and AES-256 encrypted invoicing in one suite.
          </p>
          <Link to="/features" className="inline-flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-contrast)] px-8 py-4 text-lg font-semibold text-[var(--cs-accent)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-soft)]">
            Explore Tutor Tools
            <ArrowRight className="ml-2 h-5 w-5" strokeWidth={1.75} />
          </Link>
        </div>
      </div>
    </div>
  );
}
