// One line of a task's checklist while it is being edited. Lines that already
// exist on the server keep their _id, so ticks survive a rename.
export type ChecklistDraft = { key: string; _id?: string; text: string; done?: boolean }

export const MAX_CHECKLIST_ITEMS = 50
export const MAX_CHECKLIST_TEXT = 200

let draftCounter = 0
export const newDraft = (text: string, existing?: { _id: string; done: boolean }): ChecklistDraft => ({
  key: `draft-${++draftCounter}`,
  text,
  _id: existing?._id,
  done: existing?.done,
})
