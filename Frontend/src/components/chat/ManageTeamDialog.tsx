import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getErrorMessage } from '../../api/axios';
import { chatAPI, type TeamDetail } from '../../api/chatAPI';
import { useFeedback } from '../../context/useFeedback';

interface ManageTeamDialogProps {
  // The team to manage, or null to start a new one
  team: TeamDetail | null;
  // Leaders (unless an admin froze the team) and admins may change it
  canManage: boolean;
  onClose: () => void;
  // After the details or the members changed
  onChanged: (team: TeamDetail) => void;
  // After a new team was made; the person who made it leads it now
  onCreated: (team: TeamDetail) => void;
}

const inputClass =
  'block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20';

// The team's name, description and people, kept from the chat page so that
// leaders can run the group where they talk
export default function ManageTeamDialog({ team, canManage, onClose, onChanged, onCreated }: ManageTeamDialogProps) {
  const { confirm } = useFeedback();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // showModal keeps focus inside the dialog and closes it on Escape
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // Runs an action, showing what it answered (or why it failed) in the dialog:
  // a toast would sit behind the modal
  const run = async (action: () => Promise<string | void>, fallback: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const message = await action();
      if (message) setNotice(message);
      return true;
    } catch (failure) {
      setError(getErrorMessage(failure, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the team a name.');
      return;
    }

    if (!team) {
      void run(async () => {
        const created = await chatAPI.createTeam({ name: name.trim(), description: description.trim() || undefined });
        onCreated(created);
        ref.current?.close();
      }, 'Could not create the team.');
      return;
    }

    void run(async () => {
      const updated = await chatAPI.updateTeam(team._id, { name: name.trim(), description: description.trim() });
      onChanged({ ...team, ...updated, leaders: updated.leaders ?? team.leaders, members: updated.members ?? team.members });
      return 'Team details saved.';
    }, 'Could not save the team details.');
  };

  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!team || !who.trim()) return;
    void run(async () => {
      await chatAPI.inviteToTeam(team._id, who);
      setWho('');
      return 'Invitation sent. They can accept it from their team invites.';
    }, 'Could not send the invitation.');
  };

  const remove = async (memberId: string, memberName: string) => {
    if (!team) return;
    const ok = await confirm({
      title: `Remove ${memberName} from the team?`,
      message: 'They lose access to the team chat and go back to being a regular user.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    void run(async () => {
      const updated = await chatAPI.removeFromTeam(team._id, memberId);
      onChanged({ ...team, ...updated, leaders: updated.leaders ?? team.leaders, members: updated.members ?? team.members });
      return `${memberName} was removed from the team.`;
    }, 'Could not remove this person.');
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="manage-team-title"
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-3xl bg-white p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div>
          <h2 id="manage-team-title" className="text-lg font-bold text-slate-900">
            {team ? (canManage ? 'Manage team' : 'Team details') : 'Create your team'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {team
              ? 'Leaders can update the team info, invite people and remove members.'
              : 'You will lead the team, and can invite people and manage the chat from here.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="min-w-0 space-y-5">
          <form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <label htmlFor="team-name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Team name
              </label>
              <input
                id="team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
                readOnly={Boolean(team) && !canManage}
                placeholder="Design Ops"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="team-description"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
              >
                Description
              </label>
              <textarea
                id="team-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={4}
                readOnly={Boolean(team) && !canManage}
                placeholder="What this team is for"
                className={inputClass}
              />
            </div>
            {(!team || canManage) && (
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {team ? 'Save changes' : 'Create team'}
              </button>
            )}
          </form>

          {team && canManage ? (
            <form onSubmit={invite} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label htmlFor="team-invite" className="text-sm font-semibold text-slate-900">
                  Invite someone
                </label>
                <p className="mt-1 text-xs text-slate-600">
                  Enter their name, email address or user id. They can accept the invitation from their team invites.
                </p>
              </div>
              <input
                id="team-invite"
                value={who}
                onChange={(event) => setWho(event.target.value)}
                placeholder="Name, email or user id"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy || !who.trim()}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Send invite
              </button>
            </form>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {team ? (
            <>
              <section className="rounded-2xl border border-slate-200 p-4" aria-labelledby="team-leaders-title">
                <h3 id="team-leaders-title" className="text-sm font-semibold text-slate-900">
                  Leaders
                </h3>
                <ul className="mt-3 space-y-2">
                  {team.leaders.map((leader) => (
                    <li key={leader._id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{leader.name}</p>
                        {leader.email ? <p className="truncate text-xs text-slate-600">{leader.email}</p> : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                        Leader
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4" aria-labelledby="team-members-title">
                <h3 id="team-members-title" className="text-sm font-semibold text-slate-900">
                  Members
                </h3>
                {team.members.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600">No members yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {team.members.map((member) => (
                      <li key={member._id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
                          {member.email ? <p className="truncate text-xs text-slate-600">{member.email}</p> : null}
                        </div>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => void remove(member._id, member.name)}
                            disabled={busy}
                            aria-label={`Remove ${member.name} from the team`}
                            className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
              Once the team exists you can invite people to it and manage the group chat here.
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
