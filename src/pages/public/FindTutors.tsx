import React, { useState } from 'react';
import { Search, Filter, Star, Clock, MapPin, Video, User, Users, ChevronDown, CheckCircle, ShieldCheck, BookOpen, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function FindTutors() {
  const [showQuiz, setShowQuiz] = useState(false);
  const [filters, setFilters] = useState({
    subject: '',
    level: '',
    format: 'all',
    price: 'all'
  });

  const tutors = [
    {
      id: 1,
      name: "Dr. Emily Chen",
      subject: "Mathematics",
      level: "High School & College",
      rating: 5.0,
      reviews: 124,
      hourlyRate: 65,
      formats: ['1on1', 'group'],
      image: "https://i.pravatar.cc/150?img=32",
      tags: ["Calculus", "SAT Math", "Verified"],
      availability: "Available Today"
    },
    {
      id: 2,
      name: "James Wilson",
      subject: "Physics & Chemistry",
      level: "Middle & High School",
      rating: 4.9,
      reviews: 89,
      hourlyRate: 50,
      formats: ['1on1'],
      image: "https://i.pravatar.cc/150?img=11",
      tags: ["AP Physics", "Verified"],
      availability: "Available Tomorrow"
    },
    {
      id: 3,
      name: "Sarah Martinez",
      subject: "Spanish Language",
      level: "All Levels",
      rating: 4.8,
      reviews: 210,
      hourlyRate: 40,
      formats: ['1on1', 'group'],
      image: "https://i.pravatar.cc/150?img=5",
      tags: ["Native Speaker", "Conversational"],
      availability: "Available Today"
    },
    {
      id: 4,
      name: "David Kim",
      subject: "Computer Science",
      level: "High School & College",
      rating: 5.0,
      reviews: 156,
      hourlyRate: 75,
      formats: ['group'],
      image: "https://i.pravatar.cc/150?img=68",
      tags: ["Python", "Java", "Web Dev"],
      availability: "Next Batch: Monday"
    }
  ];

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-indigo-600 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-8 md:mb-0 max-w-2xl">
              <h1 className="text-4xl font-extrabold mb-4">Find Your Perfect Tutor</h1>
              <p className="text-xl text-indigo-100">Browse verified experts or take our quick match quiz to find the ideal educator for your goals.</p>
            </div>
            <button 
              onClick={() => setShowQuiz(true)}
              className="bg-white text-indigo-600 px-8 py-4 rounded-full font-bold text-lg shadow-lg hover:bg-indigo-50 transition-colors flex items-center"
            >
              <Star className="w-5 h-5 mr-2 text-yellow-500" />
              Take the Tutor Match Quiz
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Filters Sidebar */}
          <div className="w-full lg:w-1/4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sticky top-24">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-gray-900 flex items-center">
                  <Filter className="w-5 h-5 mr-2" /> Filters
                </h2>
                <button className="text-sm text-indigo-600 hover:text-indigo-800">Clear all</button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input 
                      type="text" 
                      placeholder="Search subjects..." 
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Learning Format</label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input type="radio" name="format" className="text-indigo-600 focus:ring-indigo-500" defaultChecked />
                      <span className="ml-2 text-gray-700">All Formats</span>
                    </label>
                    <label className="flex items-center">
                      <input type="radio" name="format" className="text-indigo-600 focus:ring-indigo-500" />
                      <span className="ml-2 text-gray-700 flex items-center"><User className="w-4 h-4 mr-1" /> 1-on-1 Sessions</span>
                    </label>
                    <label className="flex items-center">
                      <input type="radio" name="format" className="text-indigo-600 focus:ring-indigo-500" />
                      <span className="ml-2 text-gray-700 flex items-center"><Users className="w-4 h-4 mr-1" /> Group Batches</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Grade Level</label>
                  <select className="w-full border border-gray-300 rounded-lg py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500">
                    <option>Any Level</option>
                    <option>Elementary</option>
                    <option>Middle School</option>
                    <option>High School</option>
                    <option>College / Uni</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Hourly Rate</label>
                  <input type="range" className="w-full accent-indigo-600" min="10" max="150" />
                  <div className="flex justify-between text-sm text-gray-500 mt-1">
                    <span>$10</span>
                    <span>$150+</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tutor Listings */}
          <div className="w-full lg:w-3/4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">248 Tutors Available</h2>
              <div className="flex items-center">
                <span className="text-sm text-gray-500 mr-2">Sort by:</span>
                <select className="border-none bg-transparent font-medium text-gray-900 focus:ring-0 cursor-pointer">
                  <option>Recommended</option>
                  <option>Highest Rated</option>
                  <option>Lowest Price</option>
                </select>
              </div>
            </div>

            <div className="space-y-6">
              {tutors.map(tutor => (
                <div key={tutor.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row gap-6">
                    <div className="flex-shrink-0">
                      <img src={tutor.image} alt={tutor.name} className="w-24 h-24 rounded-full object-cover border-4 border-gray-50" />
                    </div>
                    
                    <div className="flex-grow">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 flex items-center">
                            {tutor.name}
                            <ShieldCheck className="w-5 h-5 text-emerald-500 ml-2" title="Verified Tutor" />
                          </h3>
                          <p className="text-indigo-600 font-medium">{tutor.subject}</p>
                        </div>
                        <div className="mt-2 sm:mt-0 text-left sm:text-right">
                          <div className="text-2xl font-bold text-gray-900">${tutor.hourlyRate}<span className="text-sm text-gray-500 font-normal">/hr</span></div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                        <div className="flex items-center">
                          <Star className="w-4 h-4 text-yellow-400 fill-current mr-1" />
                          <span className="font-medium text-gray-900 mr-1">{tutor.rating}</span>
                          <span>({tutor.reviews} reviews)</span>
                        </div>
                        <div className="flex items-center">
                          <BookOpen className="w-4 h-4 mr-1" />
                          {tutor.level}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-6">
                        {tutor.tags.map(tag => (
                          <span key={tag} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="flex flex-col sm:flex-row items-center justify-between border-t border-gray-100 pt-4 mt-4">
                        <div className="flex items-center space-x-4 mb-4 sm:mb-0 w-full sm:w-auto">
                          {tutor.formats.includes('1on1') && (
                            <span className="flex items-center text-sm text-gray-600 bg-indigo-50 px-3 py-1 rounded-lg">
                              <User className="w-4 h-4 mr-1 text-indigo-600" /> 1-on-1
                            </span>
                          )}
                          {tutor.formats.includes('group') && (
                            <span className="flex items-center text-sm text-gray-600 bg-emerald-50 px-3 py-1 rounded-lg">
                              <Users className="w-4 h-4 mr-1 text-emerald-600" /> Group
                            </span>
                          )}
                        </div>
                        <div className="flex items-center w-full sm:w-auto space-x-3">
                          <span className="text-sm text-emerald-600 font-medium flex items-center">
                            <Clock className="w-4 h-4 mr-1" /> {tutor.availability}
                          </span>
                          <Link to={`/login`} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
                            View Profile
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 flex justify-center">
              <button className="bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors">
                Load More Tutors
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quiz Modal (Simplified for demo) */}
      {showQuiz && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-8 relative">
            <button onClick={() => setShowQuiz(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X className="w-6 h-6" />
            </button>
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Star className="w-8 h-8 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Tutor Match Quiz</h2>
              <p className="text-gray-600 mt-2">Answer 3 quick questions to find your perfect match.</p>
            </div>
            
            <div className="space-y-4">
              <button className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-indigo-600 hover:bg-indigo-50 transition-colors font-medium text-gray-900">
                I need help catching up in a subject.
              </button>
              <button className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-indigo-600 hover:bg-indigo-50 transition-colors font-medium text-gray-900">
                I want to get ahead and learn advanced topics.
              </button>
              <button className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-indigo-600 hover:bg-indigo-50 transition-colors font-medium text-gray-900">
                I'm preparing for a specific exam (SAT, GCSE, etc.).
              </button>
            </div>
            
            <div className="mt-8 flex justify-between items-center">
              <span className="text-sm text-gray-500">Step 1 of 3</span>
              <button className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
