import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, Users, User, BookOpen, ArrowRight, Star, CheckCircle, Calculator, Code, Globe, Beaker } from 'lucide-react';

export default function Home() {
  const [learningFormat, setLearningFormat] = useState<'1on1' | 'group'>('1on1');

  return (
    <div className="bg-white">
      {/* Hero Section: "Learn Your Way" */}
      <div className="relative overflow-hidden bg-gradient-to-b from-indigo-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 text-center">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6">
            Master Any Subject with <br className="hidden md:block" />
            <span className="text-indigo-600">1-on-1 Focus or Group Energy.</span>
          </h1>
          <p className="mt-4 text-xl text-gray-600 max-w-3xl mx-auto mb-10">
            Connect with verified experts for personalized attention or collaborative group batches. Find the perfect fit for your learning style and budget.
          </p>
          
          {/* Massive Search Bar */}
          <div className="max-w-3xl mx-auto bg-white rounded-full shadow-xl p-2 flex flex-col sm:flex-row items-center border border-gray-100">
            <div className="flex-1 flex items-center px-4 py-2 w-full sm:w-auto border-b sm:border-b-0 sm:border-r border-gray-200">
              <Search className="w-5 h-5 text-gray-400 mr-3" />
              <input 
                type="text" 
                placeholder="What do you want to learn? (e.g. Math, Python)" 
                className="w-full focus:outline-none text-gray-700 text-lg bg-transparent"
              />
            </div>
            <div className="flex-1 flex items-center px-4 py-2 w-full sm:w-auto mt-2 sm:mt-0">
              <BookOpen className="w-5 h-5 text-gray-400 mr-3" />
              <select className="w-full focus:outline-none text-gray-700 text-lg bg-transparent appearance-none cursor-pointer">
                <option value="">Any Grade Level</option>
                <option value="elementary">Elementary School</option>
                <option value="middle">Middle School</option>
                <option value="high">High School</option>
                <option value="college">College / University</option>
                <option value="adult">Adult Learning</option>
              </select>
            </div>
            <Link to="/contact" className="w-full sm:w-auto mt-2 sm:mt-0 px-8 py-4 bg-indigo-600 text-white rounded-full font-bold text-lg hover:bg-indigo-700 transition-colors flex items-center justify-center">
              Search
            </Link>
          </div>
        </div>
      </div>

      {/* The "Learning Format" Toggle */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Choose Your Learning Format</h2>
            <p className="text-xl text-gray-600">Tailor your educational journey to your specific needs.</p>
          </div>

          <div className="flex justify-center mb-12">
            <div className="bg-gray-100 p-1 rounded-xl inline-flex">
              <button
                onClick={() => setLearningFormat('1on1')}
                className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
                  learningFormat === '1on1' 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                1-on-1 Sessions
              </button>
              <button
                onClick={() => setLearningFormat('group')}
                className={`px-8 py-3 rounded-lg font-semibold text-lg transition-all ${
                  learningFormat === 'group' 
                    ? 'bg-white text-indigo-600 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Group Batches
              </button>
            </div>
          </div>

          <div className="max-w-4xl mx-auto">
            {learningFormat === '1on1' ? (
              <div className="bg-indigo-50 rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8 border border-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex-1">
                  <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6">
                    <User className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Personalized Pace & Focus</h3>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">100% customized curriculum tailored to your exact needs.</span></li>
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">Flexible scheduling that fits around your busy life.</span></li>
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">Immediate feedback and undivided attention from the tutor.</span></li>
                  </ul>
                  <Link to="/contact" className="inline-flex items-center text-indigo-600 font-bold text-lg hover:text-indigo-800">
                    Find 1-on-1 Tutors <ArrowRight className="ml-2 w-5 h-5" />
                  </Link>
                </div>
                <div className="flex-1 w-full relative">
                  <div className="aspect-video bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex items-center justify-center relative">
                    <img src="https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&q=80&w=800" alt="1-on-1 Tutoring" className="object-cover w-full h-full opacity-90" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
                      <div className="text-white">
                        <p className="font-bold text-lg">Sarah M.</p>
                        <p className="text-sm opacity-90">Advanced Calculus Session</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8 border border-emerald-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex-1">
                  <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-6">
                    <Users className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Collaborative & Budget-Friendly</h3>
                  <ul className="space-y-4 mb-8">
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">Learn alongside peers in interactive, small-group settings.</span></li>
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">More affordable rates while maintaining high-quality instruction.</span></li>
                    <li className="flex items-start"><CheckCircle className="w-6 h-6 text-green-500 mr-3 shrink-0" /><span className="text-gray-700 text-lg">Structured batch schedules for consistent learning routines.</span></li>
                  </ul>
                  <Link to="/contact" className="inline-flex items-center text-emerald-600 font-bold text-lg hover:text-emerald-800">
                    Browse Group Batches <ArrowRight className="ml-2 w-5 h-5" />
                  </Link>
                </div>
                <div className="flex-1 w-full relative">
                  <div className="aspect-video bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex items-center justify-center relative">
                    <img src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=800" alt="Group Tutoring" className="object-cover w-full h-full opacity-90" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
                      <div className="text-white">
                        <p className="font-bold text-lg">Python Basics Batch</p>
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
      <div className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Popular Subjects</h2>
            <p className="text-xl text-gray-600">Find expert tutors in high-demand areas.</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { name: "Mathematics", icon: <Calculator className="w-8 h-8 text-blue-500" />, count: "1,200+ Tutors" },
              { name: "GCSE Science", icon: <Beaker className="w-8 h-8 text-green-500" />, count: "850+ Tutors" },
              { name: "Python Coding", icon: <Code className="w-8 h-8 text-purple-500" />, count: "500+ Tutors" },
              { name: "Languages", icon: <Globe className="w-8 h-8 text-orange-500" />, count: "900+ Tutors" }
            ].map((category, idx) => (
              <Link key={idx} to="/contact" className="bg-white rounded-2xl p-6 text-center shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-200 transition-all group">
                <div className="w-16 h-16 mx-auto bg-gray-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  {category.icon}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">{category.name}</h3>
                <p className="text-sm text-gray-500">{category.count}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Trust & Safety Spotlight */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-900 rounded-3xl overflow-hidden shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="p-12 md:p-16 flex flex-col justify-center">
                <div className="inline-flex items-center space-x-2 bg-slate-800 rounded-full px-4 py-2 w-fit mb-8 border border-slate-700">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold text-sm tracking-wide uppercase">ClassStackr Verified</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">Your Safety & Success Are Guaranteed.</h2>
                <p className="text-lg text-slate-300 mb-8 leading-relaxed">
                  Every tutor on our platform goes through a rigorous 3-step vetting process before they can host a single session.
                </p>
                <ul className="space-y-6">
                  <li className="flex">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                        <span className="text-indigo-400 font-bold">1</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-white">Identity Verification</h4>
                      <p className="text-slate-400 mt-1">Government ID and background checks completed.</p>
                    </div>
                  </li>
                  <li className="flex">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                        <span className="text-indigo-400 font-bold">2</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-white">Academic Credentials</h4>
                      <p className="text-slate-400 mt-1">Degrees and certifications manually verified by our team.</p>
                    </div>
                  </li>
                  <li className="flex">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                        <span className="text-indigo-400 font-bold">3</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-semibold text-white">Mock Session Review</h4>
                      <p className="text-slate-400 mt-1">Teaching quality assessed by educational experts.</p>
                    </div>
                  </li>
                </ul>
              </div>
              <div className="relative hidden lg:block bg-slate-800">
                <img 
                  src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=1000" 
                  alt="Trust and Safety" 
                  className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-overlay"
                />
                <div className="absolute inset-0 flex items-center justify-center p-12">
                  <div className="bg-white/10 backdrop-blur-md border border-white/20 p-8 rounded-2xl max-w-sm w-full">
                    <div className="flex items-center space-x-4 mb-6">
                      <img src="https://i.pravatar.cc/150?img=32" alt="Tutor" className="w-16 h-16 rounded-full border-2 border-emerald-400" />
                      <div>
                        <h4 className="text-white font-bold text-lg">Dr. Emily Chen</h4>
                        <div className="flex items-center text-emerald-400 text-sm">
                          <ShieldCheck className="w-4 h-4 mr-1" /> Verified Expert
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 mb-4">
                      {[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />)}
                      <span className="text-white ml-2 font-medium">5.0 (124 reviews)</span>
                    </div>
                    <p className="text-slate-200 italic">"Emily helped my son jump two grade levels in Math in just 3 months. Highly recommend!"</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The Professional Pivot (Footer CTA) */}
      <div className="py-24 bg-indigo-600 text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6">Are you a Tutor? Automate your business today.</h2>
          <p className="text-xl text-indigo-100 mb-10 max-w-2xl mx-auto">
            Stop chasing payments and managing spreadsheets. Get a professional profile, automated scheduling, and AES-256 encrypted invoicing in one suite.
          </p>
          <Link to="/features" className="inline-flex items-center px-8 py-4 bg-white text-indigo-600 rounded-full font-bold text-lg hover:bg-gray-50 transition-colors shadow-xl">
            Explore Tutor Tools
            <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
