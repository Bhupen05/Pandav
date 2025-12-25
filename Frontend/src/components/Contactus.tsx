import { useState } from 'react'
import { contactAPI } from '../api/contactAPI'

export default function Contactus() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    setLoading(true)
    try {
      const response = await contactAPI.createContact({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        subject: subject.trim(),
        message: message.trim(),
      })
      
      if (response.success) {
        setSuccess(response.message || 'Message sent! Well get back to you soon.')
        setName('')
        setEmail('')
        setPhone('')
        setSubject('')
        setMessage('')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send message. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 py-12">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-8 text-center">
          <h1 className="mb-3 text-3xl font-bold text-neutral-900 md:text-4xl">Contact Us</h1>
          <p className="text-base text-neutral-600 md:text-lg">
            Have questions? We'd love to hear from you.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Contact Form */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-neutral-900">Send us a Message</h2>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium text-neutral-800">
                  Your Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-800">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="block w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="message" className="mb-1 block text-sm font-medium text-neutral-800">
                  Message
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={5}
                  className="block w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:border-neutral-900"
                  placeholder="How can we help you?"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>

          {/* Contact Information */}
          <div className="space-y-6">
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-neutral-900">Get in Touch</h2>
              <p className="mb-6 text-sm text-neutral-600">
                Reach out to us through any of the following channels. We're here to help!
              </p>

              <div className="space-y-4">
                {/* Email */}
                <a
                  href="mailto:support@pandav.com"
                  className="flex items-start gap-4 rounded-lg border p-4 transition hover:bg-neutral-50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                    <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-neutral-900">Email</h3>
                    <p className="text-sm text-neutral-600">support@pandav.com</p>
                    <p className="mt-1 text-xs text-neutral-500">We'll respond within 24 hours</p>
                  </div>
                </a>

                {/* Phone */}
                <a
                  href="tel:+1234567890"
                  className="flex items-start gap-4 rounded-lg border p-4 transition hover:bg-neutral-50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-neutral-900">Phone</h3>
                    <p className="text-sm text-neutral-600">+1 (234) 567-890</p>
                    <p className="mt-1 text-xs text-neutral-500">Mon-Fri, 9AM - 6PM EST</p>
                  </div>
                </a>

                {/* WhatsApp */}
                <a
                  href="https://wa.me/1234567890"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 rounded-lg border p-4 transition hover:bg-neutral-50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100">
                    <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-neutral-900">WhatsApp</h3>
                    <p className="text-sm text-neutral-600">+1 (234) 567-890</p>
                    <p className="mt-1 text-xs text-neutral-500">Chat with us instantly</p>
                  </div>
                </a>
              </div>
            </div>

            {/* Office Hours */}
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-neutral-900">Office Hours</h3>
              <div className="space-y-2 text-sm text-neutral-600">
                <div className="flex justify-between">
                  <span>Monday - Friday</span>
                  <span className="font-medium text-neutral-900">9:00 AM - 6:00 PM</span>
                </div>
                <div className="flex justify-between">
                  <span>Saturday</span>
                  <span className="font-medium text-neutral-900">10:00 AM - 4:00 PM</span>
                </div>
                <div className="flex justify-between">
                  <span>Sunday</span>
                  <span className="font-medium text-neutral-900">Closed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
