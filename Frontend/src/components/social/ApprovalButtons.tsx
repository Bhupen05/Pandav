import { Check, X } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText } from './format'
import { useBusy } from './hooks'
import { mergePost, authorOf, type PatchPost } from './postState'
import { BusyButton } from './ui'
import { dangerButton, smallButton, successButton } from './styles'
import type { SocialPost } from './types'

// Approve or reject a post waiting for approval (the reviewers: admins, and
// the leader of the author's team). Rejecting can't be undone: the author has
// to write a new post.
export default function ApprovalButtons({ post, onChange }: { post: SocialPost; onChange: PatchPost }) {
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()

  const decide = async (action: 'approved' | 'rejected') => {
    if (action === 'rejected') {
      const sure = await confirm({
        title: 'Reject this post?',
        message: `${authorOf(post).name} is told, and the post can never be published. They would have to write a new one.`,
        confirmLabel: 'Reject post',
        danger: true,
      })
      if (!sure) return
    }
    await run(action, async () => {
      try {
        const response = await socialV2API.approvePost(post._id, action)
        const fresh = response?.data as Partial<SocialPost> | undefined
        onChange(post._id, (old) => mergePost(old, fresh ?? { approvalStatus: action === 'approved' ? 'approved' : 'rejected' }))
        notify(action === 'approved' ? 'Post approved.' : 'Post rejected.', 'success')
      } catch (error) {
        notify(errorText(error, 'Couldn’t save your decision. Try again.'), 'error')
      }
    })
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <BusyButton
        busy={busy.approved}
        disabled={busy.rejected}
        busyLabel="Approving…"
        onClick={() => void decide('approved')}
        icon={<Check className="h-4 w-4" aria-hidden="true" />}
        className={`${successButton} ${smallButton}`}
      >
        Approve
      </BusyButton>
      <BusyButton
        busy={busy.rejected}
        disabled={busy.approved}
        busyLabel="Rejecting…"
        onClick={() => void decide('rejected')}
        icon={<X className="h-4 w-4" aria-hidden="true" />}
        className={`${dangerButton} ${smallButton}`}
      >
        Reject
      </BusyButton>
    </div>
  )
}
