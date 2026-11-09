import { WifiOff } from 'lucide-react';
import { useChat } from '../../context/useChat';

// Shown while the live connection is down: messages still send, but new ones
// from other people only appear once it is back
export default function ConnectionStrip() {
  const { connection } = useChat();
  if (connection !== 'reconnecting' && connection !== 'offline') return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">{connection === 'offline' ? 'You are offline.' : 'Reconnecting...'}</span>{' '}
        New messages may be late until the connection is back.
      </span>
    </p>
  );
}
