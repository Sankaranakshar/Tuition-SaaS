import React, { useState, useEffect, useRef } from "react";
import { Send, Search, User, MessageSquare, Plus } from "lucide-react";
import { collection, query, where, onSnapshot, addDoc, orderBy, updateDoc, doc, limit } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

export default function Messaging() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [contacts, setContacts] = useState<any[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all messages for the user
  useEffect(() => {
    if (!user || !user.organizationId) return;

    // We need to listen to messages where user is sender OR receiver.
    // Firestore doesn't easily support OR on different fields without composite indexes,
    // so we'll do two listeners and merge.
    const qSent = query(
      collection(db, "messages"),
      where("organizationId", "==", user.organizationId),
      where("senderId", "==", user.id),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const qReceived = query(
      collection(db, "messages"),
      where("organizationId", "==", user.organizationId),
      where("receiverId", "==", user.id),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    let sentMsgs: any[] = [];
    let receivedMsgs: any[] = [];

    const updateMessages = () => {
      const merged = [...sentMsgs, ...receivedMsgs];
      // Remove duplicates just in case (e.g. sending to self)
      const unique = Array.from(new Map(merged.map(m => [m.id, m])).values());
      unique.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setAllMessages(unique);
    };

    const unsubSent = onSnapshot(qSent, (snapshot) => {
      sentMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      updateMessages();
    }, (error) => {
      console.error("Firestore Error (Sent Messages): ", error);
    });

    const unsubReceived = onSnapshot(qReceived, (snapshot) => {
      receivedMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      updateMessages();
    }, (error) => {
      console.error("Firestore Error (Received Messages): ", error);
    });

    // Fetch contacts (students)
    const studentsConstraints: any[] = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') studentsConstraints.push(where("tutorId", "==", user.id));
    studentsConstraints.push(limit(100));
    const qStudents = query(collection(db, "students"), ...studentsConstraints);
    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      const contactsList: any[] = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        contactsList.push({
          id: doc.id,
          name: data.name,
          role: "student"
        });
        if (data.parentName) {
          contactsList.push({
            id: `${doc.id}_parent`,
            name: `${data.parentName} (Parent of ${data.name})`,
            role: "parent"
          });
        }
      });
      setContacts(contactsList);
    }, (error) => {
      console.error("Firestore Error (Contacts): ", error);
    });

    return () => {
      unsubSent();
      unsubReceived();
      unsubStudents();
    };
  }, [user]);

  // Process conversations from messages
  useEffect(() => {
    if (!user) return;

    const convMap = new Map<string, any>();

    allMessages.forEach(msg => {
      const partnerId = msg.senderId === user.id ? msg.receiverId : msg.senderId;
      
      if (!convMap.has(partnerId)) {
        // Try to find name from contacts
        const contact = contacts.find(c => c.id === partnerId);
        convMap.set(partnerId, {
          id: partnerId,
          name: contact ? contact.name : "Unknown User",
          role: contact ? contact.role : "user",
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt,
          unreadCount: (msg.receiverId === user.id && !msg.read) ? 1 : 0
        });
      } else {
        const conv = convMap.get(partnerId);
        if (new Date(msg.createdAt) > new Date(conv.lastMessageTime)) {
          conv.lastMessage = msg.content;
          conv.lastMessageTime = msg.createdAt;
        }
        if (msg.receiverId === user.id && !msg.read) {
          conv.unreadCount += 1;
        }
      }
    });

    const convList = Array.from(convMap.values()).sort((a, b) => 
      new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    );

    setConversations(convList);
  }, [allMessages, user, contacts]);

  // Update active conversation messages
  useEffect(() => {
    if (activeConversation && user) {
      const activeMsgs = allMessages.filter(m => 
        (m.senderId === user.id && m.receiverId === activeConversation.id) ||
        (m.senderId === activeConversation.id && m.receiverId === user.id)
      );
      setMessages(activeMsgs);

      // Mark as read
      activeMsgs.forEach(msg => {
        if (msg.receiverId === user.id && !msg.read) {
          updateDoc(doc(db, "messages", msg.id), { read: true }).catch(console.error);
        }
      });
    }
  }, [activeConversation, allMessages, user]);

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation || !user || !user.organizationId) return;

    try {
      await addDoc(collection(db, "messages"), {
        organizationId: user.organizationId,
        senderId: user.id,
        receiverId: activeConversation.id,
        content: newMessage,
        read: false,
        createdAt: new Date().toISOString()
      });
      setNewMessage("");
    } catch (error: any) {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "create",
        path: "messages"
      }));
    }
  };

  const startNewChat = (contact: any) => {
    setActiveConversation(contact);
    setShowNewChatModal(false);
  };

  return (
    <div className="h-[calc(100vh-100px)] flex bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Sidebar - Conversations List */}
      <div className="w-1/3 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">Channels</h2>
          <button 
            onClick={() => { setShowNewChatModal(true); }}
            className="p-2 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search messages..." 
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto text-gray-300 mb-2" />
              <p>No conversations yet</p>
            </div>
          ) : (
            conversations.map(conv => (
              <div 
                key={conv.id}
                onClick={() => setActiveConversation(conv)}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${activeConversation?.id === conv.id ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : ''}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-medium text-gray-900">{conv.name}</h3>
                  {conv.lastMessageTime && (
                    <span className="text-xs text-gray-500">
                      {new Date(conv.lastMessageTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-500 truncate w-3/4">
                    {conv.senderId === user?.id ? 'You: ' : ''}{conv.lastMessage}
                  </p>
                  {conv.unreadCount > 0 && (
                    <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-200 flex items-center bg-white">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold mr-3">
                {activeConversation.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-medium text-gray-900">{activeConversation.name}</h3>
                <span className="text-xs text-gray-500 capitalize">{activeConversation.role}</span>
              </div>
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {messages.map((msg, index) => {
                const isMe = msg.senderId === user?.id;
                return (
                  <div key={msg.id || index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-lg px-4 py-2 ${isMe ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-900'}`}>
                      <p className="text-sm">{msg.content}</p>
                      <p className={`text-[10px] mt-1 text-right ${isMe ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button 
                  type="submit" 
                  disabled={!newMessage.trim()}
                  className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-gray-50">
            <MessageSquare className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">Select a conversation</h3>
            <p>Choose a contact from the left to start messaging</p>
          </div>
        )}
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setShowNewChatModal(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Start New Conversation</h3>
                <div className="mt-2 max-h-60 overflow-y-auto">
                  {contacts.length === 0 ? (
                    <p className="text-sm text-gray-500">No contacts found.</p>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {contacts.map(contact => (
                        <li 
                          key={contact.id} 
                          onClick={() => startNewChat(contact)}
                          className="py-3 flex items-center cursor-pointer hover:bg-gray-50 px-2 rounded-md"
                        >
                          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold mr-3">
                            {contact.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{contact.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{contact.role}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" onClick={() => setShowNewChatModal(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
