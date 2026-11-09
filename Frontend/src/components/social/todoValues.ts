import { dueDay } from './format'
import type { PersonalTask, PersonalTaskStatus, Priority } from './types'

// Limits of a personal to-do's fields (Backend/Doc/SocialHub.md, POST /personal-tasks)
export const TODO_TITLE_MAX = 160
export const TODO_DESCRIPTION_MAX = 1500

export type TodoValues = {
  title: string
  description: string
  priority: Priority
  // A day, "2026-11-30", or empty
  dueDate: string
  autoShare: boolean
  status: PersonalTaskStatus
}

export const blankTodo: TodoValues = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: '',
  autoShare: false,
  status: 'todo',
}

export const todoValuesOf = (task: PersonalTask): TodoValues => ({
  title: task.title,
  description: task.description ?? '',
  priority: task.priority,
  dueDate: dueDay(task.dueDate),
  autoShare: task.autoGenerateLinkedInPost,
  status: task.status,
})

// The draft the server offers when a to-do is finished, for a to-do that is
// shared on request instead (Backend/Doc/SocialHub.md, "Personal tasks and auto-share")
export const shareDraftOf = (task: PersonalTask, ownerName: string) => ({
  title: `Task completed: ${task.title}`,
  content: [
    `Completed task: ${task.title}`,
    task.description ? `Summary: ${task.description}` : '',
    'Status: completed',
    `Priority: ${task.priority}`,
    `Completed by: ${ownerName}`,
    'Shared from Pandav V2',
  ]
    .filter(Boolean)
    .join('\n'),
})
