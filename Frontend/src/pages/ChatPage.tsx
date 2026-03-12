import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import Chat from '../components/Chat';
import { useAuth } from '../context/AuthContext';

interface UserItem {
  _id: string;
  name: string;
  email: string;
}

export default function ChatPage() {
  const { token, isAuthenticated } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    const authToken = token || sessionStorage.getItem('token') || localStorage.getItem('token');
    fetch(`${import.meta.env.VITE_API_URL}/users/chat-list`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then(r => r.json())
      .then(data => {
        const list: UserItem[] = Array.isArray(data) ? data : data.data ?? [];
        setUsers(list);
      })
      .catch(console.error)
      .finally(() => setLoadingUsers(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto flex max-w-5xl gap-4 px-4 py-8 h-[calc(100vh-80px)]">
      {/* User list */}
      <div className="w-64 shrink-0 rounded-lg border bg-white shadow-sm overflow-y-auto">
        <div className="border-b px-4 py-3 font-semibold text-neutral-700">Conversations</div>
        {loadingUsers ? (
          <div className="flex flex-col gap-1 p-2 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-gray-200" />
                  <div className="h-2.5 w-32 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-400">No users found</p>
        ) : (
          users.map(u => (
            <button
              key={u._id}
              onClick={() => setSelectedUser(u)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 ${
                selectedUser?._id === u._id ? 'bg-emerald-50 border-l-2 border-emerald-600' : ''
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                {u.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{u.name}</p>
                <p className="truncate text-xs text-neutral-400">{u.email}</p>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0">
        {selectedUser ? (
          <Chat receiverId={selectedUser._id} receiverName={selectedUser.name} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border bg-white shadow-sm">
            <p className="text-neutral-400">Select a person to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

