import { getErrorMessage } from '../../api/axios'
import { CONTACT_HOURLY_LIMIT, CONTACT_LIMITS, type ContactError, type ContactField } from '../../api/contactAPI'

export type ContactValues = Record<ContactField, string>
export type ContactErrors = Partial<Record<ContactField, string>>

export const EMPTY_CONTACT: ContactValues = { name: '', email: '', phone: '', subject: '', message: '' }

// The fields in the order they appear, for focusing the first problem
export const CONTACT_FIELDS: ContactField[] = ['name', 'email', 'phone', 'subject', 'message']

const LABELS: Record<ContactField, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  subject: 'Subject',
  message: 'Message',
}

// A light check: the server has the final say (and its message is shown)
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

// What is wrong with each field before anything is sent. The server trims, so
// the limits apply to the trimmed text.
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {}
  const trimmed = Object.fromEntries(
    CONTACT_FIELDS.map((field) => [field, values[field].trim()]),
  ) as ContactValues

  if (!trimmed.name) errors.name = 'Enter your name.'
  if (!trimmed.email) errors.email = 'Enter your email address.'
  else if (!looksLikeEmail(trimmed.email)) errors.email = 'Enter an email address like name@example.com.'
  if (!trimmed.subject) errors.subject = 'Enter a subject.'
  if (!trimmed.message) errors.message = 'Enter your message.'

  for (const field of CONTACT_FIELDS) {
    if (!errors[field] && trimmed[field].length > CONTACT_LIMITS[field]) {
      errors[field] = `${LABELS[field]} can be at most ${CONTACT_LIMITS[field]} characters.`
    }
  }
  return errors
}

// Which field a message from the server is about ("Subject is required",
// "Please provide a valid email", ...). Several come joined with "; ".
const fieldOf = (problem: string): ContactField | undefined => {
  const text = problem.toLowerCase()
  if (text.startsWith('name')) return 'name'
  if (text.includes('email')) return 'email'
  if (text.startsWith('phone')) return 'phone'
  if (text.startsWith('subject')) return 'subject'
  if (text.startsWith('message')) return 'message'
  return undefined
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

// Splits a 400's message into per-field errors and whatever is left over
export function splitServerProblems(message: string): { fields: ContactErrors; rest: string[] } {
  const fields: ContactErrors = {}
  const rest: string[] = []
  for (const part of message.split(';').map((piece) => piece.trim()).filter(Boolean)) {
    const field = fieldOf(part)
    if (field && !fields[field]) fields[field] = sentence(part)
    else rest.push(sentence(part))
  }
  return { fields, rest }
}

// "about 20 minutes", "about an hour"
export function describeWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes <= 1) return 'about a minute'
  if (minutes < 60) return `about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`
}

// The banner text for a refused or failed send
export function describeSendError(error: ContactError): string {
  if (error.status === 429) {
    const wait = error.retryAfter ? ` You can send another in ${describeWait(error.retryAfter)}.` : ''
    return `${sentence(getErrorMessage(error, 'Too many messages sent. Please try again later.'))} To keep out spam, the form takes up to ${CONTACT_HOURLY_LIMIT} messages an hour from each connection.${wait}`
  }
  if (!error.status) {
    return "We couldn't reach the server. Check your internet connection and try again."
  }
  if (error.status >= 500) {
    return 'Something went wrong on our side and your message was not sent. Please try again in a few minutes.'
  }
  return sentence(getErrorMessage(error, 'Your message could not be sent. Please try again.'))
}
