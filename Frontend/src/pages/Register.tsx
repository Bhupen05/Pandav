import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { authAPI } from '../api/authAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import { resizeImage } from '../utils/resizeImage'
import { CHANGE_PASSWORD_ROUTE, getDashboardRouteForRole } from '../utils/roleRedirect'
import { useAuthConfig } from '../utils/useAuthConfig'
import AuthCard from '../components/shell/AuthCard'
import Avatar from '../components/shell/Avatar'
import { errorBoxClass, inputClass, labelClass, linkClass, primaryButtonClass, secondaryButtonClass } from '../components/shell/formStyles'

// A hint about the password, not a rule: the server only checks the length
function passwordStrength(password: string, minLength: number) {
  if (!password) return { level: 0, label: '' }
  let points = 0
  if (password.length >= minLength) points += 1
  if (password.length >= 10) points += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1
  if (/\d/.test(password)) points += 1
  if (/[^A-Za-z0-9]/.test(password)) points += 1
  if (password.length < minLength) return { level: 1, label: 'Too short' }
  if (points <= 2) return { level: 2, label: 'Fair: add more characters, capitals, numbers or symbols' }
  if (points === 3) return { level: 3, label: 'Good' }
  return { level: 4, label: 'Strong' }
}

const STRENGTH_COLOURS = ['bg-neutral-200', 'bg-red-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600']

function Register() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    department: '',
    profileImage: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const navigate = useNavigate()
  const { user, loading: checkingSession } = useAuth()
  const { mailEnabled, passwordMinLength } = useAuthConfig()
  const strength = passwordStrength(formData.password, passwordMinLength)

  // Someone who is already signed in has no use for this page
  useEffect(() => {
    if (checkingSession || !user) return
    navigate(user.mustChangePassword ? CHANGE_PASSWORD_ROUTE : getDashboardRouteForRole(user.role), { replace: true })
  }, [checkingSession, user, navigate])

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    // Forget the choice, so picking the same file again still counts as a change
    input.value = ''
    if (!file) return

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB')
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file')
      return
    }

    setUploadingImage(true)
    setError(null)
    try {
      const profileImage = await resizeImage(file)
      setFormData((prev) => ({ ...prev, profileImage }))
    } catch {
      setError('Failed to process image')
    } finally {
      setUploadingImage(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)

    // Validation
    if (!formData.name.trim() || !formData.email || !formData.password) {
      setError('Please fill in all required fields.')
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    // Password validation
    if (formData.password.length < passwordMinLength) {
      setError(`Password must be at least ${passwordMinLength} characters long.`)
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const response = await authAPI.register({
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        phone: formData.phone.trim() || undefined,
        department: formData.department || undefined,
        profileImage: formData.profileImage || undefined,
      })

      if (response.success) {
        navigate('/login', {
          state: {
            message: mailEnabled
              ? 'Registration successful! Check your email to confirm your address, then sign in.'
              : 'Registration successful! Please sign in.',
          },
        })
      } else {
        setError(response.message || 'Registration failed. Please try again.')
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Registration failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Create an account"
      subtitle="Sign up to get started"
      footer={
        <>
          Already have an account? <Link to="/login" className={linkClass}>Sign in</Link>
        </>
      }
    >
      {error && (
        <div role="alert" className={`mb-4 ${errorBoxClass}`}>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Profile Picture */}
        <div>
          <p className="mb-2 block text-sm font-medium text-neutral-800">Profile Picture (Optional)</p>
          <div className="flex items-center gap-4">
            <Avatar name={formData.name} src={formData.profileImage} className="h-20 w-20 text-2xl" />
            <div className="min-w-0 flex-1">
              <input
                ref={fileInputRef}
                id="profile-image"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploadingImage}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className={secondaryButtonClass}
              >
                <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                {uploadingImage ? 'Processing...' : formData.profileImage ? 'Change photo' : 'Add photo'}
              </button>
              <p className="mt-1 text-xs text-neutral-500">PNG, JPEG, WebP or GIF, up to 5 MB</p>
              {formData.profileImage && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, profileImage: '' })}
                  className="mt-1 rounded text-xs text-red-700 hover:text-red-800 hover:underline"
                >
                  Remove image
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Full Name */}
        <div>
          <label htmlFor="name" className={labelClass}>
            Full Name <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            className={inputClass}
            placeholder="John Doe"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className={labelClass}>
            Email <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone Number
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className={inputClass}
            placeholder="+1234567890"
          />
        </div>

        {/* Department */}
        <div>
          <label htmlFor="department" className={labelClass}>
            Department
          </label>
          <select
            id="department"
            autoComplete="organization-title"
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
            className={inputClass}
          >
            <option value="">Select Department</option>
            <option value="Frontend Developer">Frontend Developer</option>
            <option value="Backend Developer">Backend Developer</option>
            <option value="Full Stack Developer">Full Stack Developer</option>
            <option value="UI/UX Designer">UI/UX Designer</option>
            <option value="Digital Marketing">Digital Marketing</option>
            <option value="DevOps">DevOps</option>
            <option value="Quality Assurance">Quality Assurance</option>
            <option value="Product Manager">Product Manager</option>
            <option value="Data Science">Data Science</option>
            <option value="Human Resources">Human Resources</option>
            <option value="Sales">Sales</option>
            <option value="Finance">Finance</option>
            <option value="Operations">Operations</option>
            <option value="Customer Support">Customer Support</option>
          </select>
        </div>

        {/* Password */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
              Password <span className="text-red-600" aria-hidden="true">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password text' : 'Show password text'}
              className="rounded text-xs text-neutral-600 hover:text-neutral-900"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            minLength={passwordMinLength}
            aria-describedby="password-hint"
            className={inputClass}
            placeholder={`Minimum ${passwordMinLength} characters`}
          />
          <div id="password-hint" className="mt-2" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((segment) => (
                <span
                  key={segment}
                  className={`h-1.5 flex-1 rounded-full ${strength.level >= segment ? STRENGTH_COLOURS[strength.level] : 'bg-neutral-200'}`}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-neutral-600">
              {strength.label
                ? `Password strength: ${strength.label}`
                : `Use at least ${passwordMinLength} characters. Longer is stronger; mix letters, numbers and symbols.`}
            </p>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral-800">
              Confirm Password <span className="text-red-600" aria-hidden="true">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              aria-pressed={showConfirmPassword}
              aria-label={showConfirmPassword ? 'Hide confirmation text' : 'Show confirmation text'}
              className="rounded text-xs text-neutral-600 hover:text-neutral-900"
            >
              {showConfirmPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            required
            className={inputClass}
            placeholder="Re-enter password"
          />
        </div>

        <button type="submit" disabled={loading || uploadingImage} className={`w-full ${primaryButtonClass}`}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  )
}

export default Register
