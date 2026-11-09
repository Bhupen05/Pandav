import { useState } from 'react';
import { getErrorMessage } from '../../api/axios';
import { useChat } from '../../context/useChat';
import { useFeedback } from '../../context/useFeedback';

interface Person {
  _id: string;
  name: string;
  profileImage?: string | null;
}

// Blocking and unblocking, each after a confirmation, with the result as a toast
export function useBlocking() {
  const { confirm, notify } = useFeedback();
  const { blockUser, unblockUser } = useChat();
  const [busy, setBusy] = useState(false);

  const block = async (person: Person) => {
    const ok = await confirm({
      title: `Block ${person.name}?`,
      message:
        "You won't be able to message each other, and you won't see each other online or typing. Your Social Hub connection with them, if you have one, ends. They are not told.",
      confirmLabel: 'Block',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      notify(await blockUser(person), 'success');
    } catch (error) {
      notify(getErrorMessage(error, 'Could not block this person.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (person: Person) => {
    const ok = await confirm({
      title: `Unblock ${person.name}?`,
      message:
        "You'll be able to message each other again if you still share a team or a connection. A Social Hub connection that ended when you blocked them is not restored.",
      confirmLabel: 'Unblock',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await unblockUser(person._id);
      notify(`You unblocked ${person.name}.`, 'success');
    } catch (error) {
      notify(getErrorMessage(error, 'Could not unblock this person.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return { block, unblock, busy };
}
