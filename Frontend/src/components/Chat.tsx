import { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';

interface ChatProps {
  receiverId: string;
  receiverName: string;
}

export default function Chat({ receiverId, receiverName }: ChatProps) {
  const { messages, sendMessage, fetchMessages, loadingMessages } = useChat();
  const { user } = useAuth();
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (receiverId) fetchMessages(receiverId);
  }, [receiverId]);

  const handleSend = async () => {
    if (!inputMessage.trim() || sending) return;
    setSending(true);
    await sendMessage(receiverId, inputMessage);
    setInputMessage('');
    setSending(false);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const currentUserId = user?._id;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-md">
      <div className="border-b px-4 py-3 font-semibold text-neutral-800 bg-neutral-50 rounded-t-lg">
        {receiverName}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loadingMessages ? (
          <div className="flex flex-col gap-3 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <div className={`h-10 rounded-lg bg-gray-200 ${i % 2 === 0 ? 'w-48' : 'w-36'}`} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 mt-8">No messages yet. Say hello!</p>
        ) : (
          messages.map((msg, idx) => {
            const isMine = (msg.sender?._id || msg.sender) === currentUserId;
            return (
              <div key={msg._id || idx} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs px-4 py-2 rounded-lg ${
                  isMine ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-900'
                }`}>
                  <p className="text-sm">{msg.message}</p>
                  <span className="text-xs opacity-70">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4 flex gap-2">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={`Message ${receiverName}...`}
          className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={handleSend}
          disabled={sending || !inputMessage.trim()}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}