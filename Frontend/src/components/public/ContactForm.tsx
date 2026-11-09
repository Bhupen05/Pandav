import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../../api/axios'
import { contactAPI, CONTACT_LIMITS, type ContactError, type ContactField } from '../../api/contactAPI'
import {
  CONTACT_FIELDS,
  EMPTY_CONTACT,
  describeSendError,
  splitServerProblems,
  validateContact,
  type ContactErrors,
  type ContactValues,
} from './contactRules'

type FieldElement = HTMLInputElement | HTMLTextAreaElement

interface Banner {
  tone: 'success' | 'error'
  text: string
}

interface FieldProps {
  field: ContactField
  label: string
  value: string
  error?: string
  required?: boolean
  type?: 'text' | 'email' | 'tel'
  autoComplete?: string
  placeholder?: string
  multiline?: boolean
  onChange: (field: ContactField, value: string) => void
  register: (field: ContactField, element: FieldElement | null) => void
}

// The count turns amber close to the limit and red at it
const counterClass = (length: number, limit: number) =>
  length >= limit ? 'text-red-600' : length >= limit * 0.9 ? 'text-amber-600' : 'text-neutral-500'

function ContactInput({
  field,
  label,
  value,
  error,
  required = false,
  type = 'text',
  autoComplete,
  placeholder,
  multiline = false,
  onChange,
  register,
}: FieldProps) {
  const id = `contact-${field}`
  const limit = CONTACT_LIMITS[field]
  const describedBy = `${error ? `${id}-error ` : ''}${id}-count`
  const className = `block w-full rounded-md border bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:ring-2 ${
    error
      ? 'border-red-500 focus:border-red-600 focus:ring-red-500/20'
      : 'border-neutral-300 hover:border-neutral-400 focus:border-neutral-900 focus:ring-neutral-900/10'
  }`
  const shared = {
    id,
    name: field,
    value,
    required,
    maxLength: limit,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    className,
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-800">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          ref={(element) => register(field, element)}
          rows={6}
          onChange={(event) => onChange(field, event.target.value)}
          className={`${className} resize-y`}
        />
      ) : (
        <input
          {...shared}
          ref={(element) => register(field, element)}
          type={type}
          autoComplete={autoComplete}
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
      <div className="mt-1 flex items-start justify-between gap-3 text-xs">
        {error ? (
          <p id={`${id}-error`} className="text-red-600">
            {error}
          </p>
        ) : (
          <span />
        )}
        <span id={`${id}-count`} className={`shrink-0 tabular-nums ${counterClass(value.length, limit)}`}>
          <span aria-hidden="true">
            {value.length}/{limit}
          </span>
          <span className="sr-only">
            {value.length} of {limit} characters
          </span>
        </span>
      </div>
    </div>
  )
}

// The public contact form. `initialSubject` pre-fills the subject (from
// /contact?topic=..., used by the Pricing page).
export default function ContactForm({ initialSubject = '' }: { initialSubject?: string }) {
  const [values, setValues] = useState<ContactValues>({
    ...EMPTY_CONTACT,
    subject: initialSubject.slice(0, CONTACT_LIMITS.subject),
  })
  const [errors, setErrors] = useState<ContactErrors>({})
  const [banner, setBanner] = useState<Banner | null>(null)
  const [sending, setSending] = useState(false)
  const fields = useRef<Partial<Record<ContactField, FieldElement | null>>>({})
  const honeypot = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)

  // Bring the result into view (on a phone the button is far below it) and
  // let screen readers read it
  useEffect(() => {
    if (banner) bannerRef.current?.focus()
  }, [banner])

  const register = (field: ContactField, element: FieldElement | null) => {
    fields.current[field] = element
  }

  const focusFirstProblem = (found: ContactErrors) => {
    const first = CONTACT_FIELDS.find((field) => found[field])
    if (first) fields.current[first]?.focus()
  }

  const handleChange = (field: ContactField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }))
    // The message no longer describes what is typed
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending) return
    setBanner(null)

    const found = validateContact(values)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      focusFirstProblem(found)
      return
    }

    setSending(true)
    try {
      const response = await contactAPI.createContact({
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim() || undefined,
        subject: values.subject.trim(),
        message: values.message.trim(),
        website: honeypot.current?.value ?? '',
      })
      const sent = (response?.message as string | undefined)?.replace(/\.$/, '') || 'Your message has been sent'
      setValues(EMPTY_CONTACT)
      setErrors({})
      if (honeypot.current) honeypot.current.value = ''
      setBanner({ tone: 'success', text: `${sent}. We'll get back to you soon.` })
    } catch (caught) {
      const error = caught as ContactError
      if (error.status === 400) {
        const { fields: serverErrors, rest } = splitServerProblems(getErrorMessage(error, ''))
        setErrors(serverErrors)
        if (rest.length > 0 || !Object.values(serverErrors).some(Boolean)) {
          setBanner({ tone: 'error', text: rest.join(' ') || describeSendError(error) })
        } else {
          focusFirstProblem(serverErrors)
        }
      } else {
        setBanner({ tone: 'error', text: describeSendError(error) })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {banner && (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role={banner.tone === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 ${
            banner.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 focus-visible:ring-red-300'
              : 'border-green-200 bg-green-50 text-green-700 focus-visible:ring-green-300'
          }`}
        >
          {banner.text}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="relative space-y-4" aria-describedby="contact-required-note">
        <p id="contact-required-note" className="text-xs text-neutral-500">
          Fields marked <span aria-hidden="true" className="text-red-600">*</span>
          <span className="sr-only">with a star</span> are required.
        </p>

        <ContactInput
          field="name"
          label="Your Name"
          value={values.name}
          error={errors.name}
          required
          autoComplete="name"
          placeholder="John Doe"
          onChange={handleChange}
          register={register}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <ContactInput
            field="email"
            label="Email Address"
            type="email"
            value={values.email}
            error={errors.email}
            required
            autoComplete="email"
            placeholder="you@example.com"
            onChange={handleChange}
            register={register}
          />
          <ContactInput
            field="phone"
            label="Phone (optional)"
            type="tel"
            value={values.phone}
            error={errors.phone}
            autoComplete="tel"
            placeholder="+91 98765 43210"
            onChange={handleChange}
            register={register}
          />
        </div>

        <ContactInput
          field="subject"
          label="Subject"
          value={values.subject}
          error={errors.subject}
          required
          placeholder="What is it about?"
          onChange={handleChange}
          register={register}
        />

        <ContactInput
          field="message"
          label="Message"
          value={values.message}
          error={errors.message}
          required
          multiline
          placeholder="How can we help you?"
          onChange={handleChange}
          register={register}
        />

        {/* Left empty by people, who never see it; bots that fill in every field fill it in too */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] top-0 h-px w-px overflow-hidden opacity-0">
          <label htmlFor="contact-website">Leave this field empty</label>
          <input ref={honeypot} id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </>
  )
}
