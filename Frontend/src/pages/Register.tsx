import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authAPI } from '../api/authAPI'

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
  
  const navigate = useNavigate()

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return
    
    const file = e.target.files[0]
    
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
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64String = reader.result as string
        setFormData({ ...formData, profileImage: base64String })
        setUploadingImage(false)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      setUploadingImage(false)
      setError('Failed to process image')
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!formData.name || !formData.email || !formData.password) {
      setError('Please fill in all required fields.')
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email address.')
      return
    }

    // Password validation
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long.')
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
        role: 'employee', // Default role for self-registration
      })

      if (response.success) {
        navigate('/login', { state: { message: 'Registration successful! Please login.' } })
      } else {
        setError(response.message || 'Registration failed. Please try again.')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Create an account</h1>
        <p className="mb-6 text-sm text-neutral-600">Sign up to get started</p>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Profile Picture */}
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-800">Profile Picture (Optional)</label>
            <div className="flex items-center gap-4">
              <div className="relative">
                {formData.profileImage ? (
                  <img
                    src={formData.profileImage}
                    alt="Profile preview"
                    className="h-20 w-20 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const fallback = e.currentTarget.nextElementSibling
                      if (fallback) fallback.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-700 ${formData.profileImage ? 'hidden' : ''}`}>
                  {formData.name ? formData.name.split(' ').map(n => n[0]).join('').toUpperCase() : '?'}
                </div>
                <label
                  htmlFor="profile-image"
                  className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  title="Upload profile picture"
                >
                  {uploadingImage ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </label>
                <input
                  id="profile-image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={uploadingImage}
                  className="hidden"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm text-neutral-700">Add a profile picture</p>
                <p className="mt-1 text-xs text-neutral-500">Click the camera icon (max 5MB)</p>
                {formData.profileImage && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, profileImage: '' })}
                    className="mt-2 text-xs text-red-600 hover:text-red-800"
                  >
                    Remove image
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-neutral-800">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="John Doe"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-800">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="you@example.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium text-neutral-800">
              Phone Number
            </label>
            <input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="+1234567890"
            />
          </div>

          {/* Department */}
          <div>
            <label htmlFor="department" className="mb-1 block text-sm font-medium text-neutral-800">
              Department
            </label>
            <select
              id="department"
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
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
                Password <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-xs text-neutral-600 hover:text-neutral-900"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              minLength={6}
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="Minimum 6 characters"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral-800">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="text-xs text-neutral-600 hover:text-neutral-900"
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              required
              className="block w-full rounded-md border px-3 py-2 text-sm outline-none ring-0 focus:border-neutral-900"
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || uploadingImage}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-600">
          Already have an account? <Link to="/login" className="font-medium text-emerald-600 hover:text-emerald-700">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

export default Register
