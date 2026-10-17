# Pandav - Employee Management System

A full-stack MERN application for managing employee tasks, attendance, and performance tracking with role-based access control.

## 🚀 Features

### For Regular Users
- **Task Management**: View and manage assigned tasks with priority levels and status tracking
- **Attendance System**: Check-in/check-out functionality with work hours calculation
- **Profile Management**: Update personal information and upload profile pictures
- **Activity Dashboard**: View task completion streaks and performance metrics

### For Administrators
- **Complete Task Oversight**: View, create, edit, and delete all tasks across the organization
- **User Management**: Manage employee accounts and permissions
- **Attendance Monitoring**: Track all employee attendance records and work hours
- **Analytics Dashboard**: View comprehensive statistics including:
  - Task completion rates
  - Employee performance metrics
  - Attendance trends
  - Department-wise analytics

### General Features
- **Authentication & Authorization**: Secure JWT-based authentication with role-based access
- **Responsive Design**: Mobile-first design with TailwindCSS
- **Real-time Updates**: Automatic data refresh and synchronization
- **Profile Pictures**: Base64 image upload and storage
- **Activity Heatmap**: GitHub-style contribution calendar

## 🛠️ Tech Stack

### Frontend
- **React 19.2** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **React Router 7** - Client-side routing
- **TailwindCSS 4** - Utility-first CSS framework
- **Axios** - HTTP client with interceptors

### Backend
- **Node.js** - Runtime environment
- **Express.js 4** - Web framework
- **MongoDB** - NoSQL database
- **Mongoose 8** - ODM for MongoDB
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing

## 📁 Project Structure

```
Pandav/
├── Frontend/
│   ├── src/
│   │   ├── api/              # API service layer
│   │   │   ├── axios.ts      # Axios instance with interceptors
│   │   │   ├── authAPI.ts    # Authentication endpoints
│   │   │   ├── taskAPI.ts    # Task management endpoints
│   │   │   ├── userAPI.ts    # User management endpoints
│   │   │   └── attendanceAPI.ts
│   │   ├── components/       # Reusable components
│   │   │   ├── Navbar.tsx    # Navigation with profile dropdown
│   │   │   ├── Tasksadd.tsx  # Task creation form
│   │   │   ├── Taskscard.tsx # Task display card
│   │   │   ├── Attendance.tsx # Attendance management
│   │   │   └── Contactus.tsx
│   │   ├── context/          # React Context
│   │   │   └── AuthContext.tsx # Authentication state
│   │   ├── pages/            # Page components
│   │   │   ├── Landing.tsx   # Home page
│   │   │   ├── Login.tsx     # Login/Register
│   │   │   ├── Profile.tsx   # User profile with heatmap
│   │   │   ├── Tasks.tsx     # User task view
│   │   │   ├── AdminDashboard.tsx # Admin panel
│   │   │   ├── About.tsx
│   │   │   └── Service.tsx
│   │   ├── App.tsx           # Main app component
│   │   └── main.tsx          # Entry point
│   ├── package.json
│   └── vite.config.ts
│
└── Backend/
    ├── src/
    │   ├── config/
    │   │   └── database.js   # MongoDB connection
    │   ├── controllers/      # Request handlers
    │   │   ├── authController.js
    │   │   ├── taskController.js
    │   │   ├── userController.js
    │   │   ├── attendanceController.js
    │   │   └── contactController.js
    │   ├── models/           # Mongoose schemas
    │   │   ├── User.js       # User model with profileImage
    │   │   ├── Task.js       # Task model
    │   │   ├── Attendance.js # Attendance model
    │   │   └── Contact.js
    │   ├── routes/           # API routes
    │   │   ├── authRoutes.js
    │   │   ├── taskRoutes.js
    │   │   ├── userRoutes.js
    │   │   ├── attendanceRoutes.js
    │   │   └── contactRoutes.js
    │   ├── middleware/
    │   │   └── auth.js       # JWT verification & authorization
    │   └── server.js         # Express app setup
    ├── package.json
    └── .env
```

## 🔧 Installation & Setup

### Prerequisites
- Node.js (v18 or higher)
- MongoDB (local or Atlas)
- Git

### Backend Setup

1. **Navigate to Backend directory**
```bash
cd Backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Create .env file**
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/pandav
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRE=7d
NODE_ENV=development
```

4. **Start the server**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The backend will run on `http://localhost:5000`

### Frontend Setup

1. **Navigate to Frontend directory**
```bash
cd Frontend
```

2. **Install dependencies**
```bash
npm install
```

3. **Start development server**
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

4. **Build for production**
```bash
npm run build
npm run preview
```

## 🔑 Environment Variables

### Backend (.env)
| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/pandav` |
| `JWT_SECRET` | Secret key for JWT signing | `your_secret_key` |
| `JWT_EXPIRE` | How long a "remember me" session lasts (other sessions end when the browser closes, and after a day at most) | `30d` |
| `NODE_ENV` | Environment mode | `development` or `production` |
| `CLIENT_URL` | Deployed frontend origin(s), comma-separated (required in production). Browsers on other origins can't call the API or post with the session cookie | `https://your-app.vercel.app` |
| `ORIGIN_SECRET` | Shared with Vercel (same name and value there). When set, the API only answers requests that come through the frontend's `/api` proxy, and rate limits count each visitor's real IP | output of `openssl rand -hex 32` |
| `APP_TIMEZONE` | Timezone that decides an attendance record's day | `Asia/Kolkata` |

### Frontend (`Frontend/.env`, or the host's environment settings)
| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_BACKEND_URL` | The backend's address, without `/api`. Chat sockets connect to it; in development Vite forwards `/api` to it. Production builds read it from `Frontend/.env.production` | `http://localhost:5000` |
| `ORIGIN_SECRET` | Vercel only: the same value as the backend's `ORIGIN_SECRET`. `vercel.json` adds it to every proxied request | |
| `VITE_CONTACT_EMAIL` | Email shown on the Contact page (hidden if unset) | `support@example.com` |
| `VITE_CONTACT_PHONE` | Phone number shown on the Contact page (hidden if unset) | `+91 98765 43210` |
| `VITE_CONTACT_WHATSAPP` | WhatsApp number shown on the Contact page (hidden if unset) | `+91 98765 43210` |

## 🧪 Tests and CI

The backend has end-to-end tests in `Backend/test/`. Each suite starts the real server on its own
throwaway database (`pandav_test_<suite>`, dropped before every run) and exercises the API the way
the app uses it: security, everyday workflows, data integrity, and the migration script.

They need Node.js 22 or newer and a running MongoDB server:

```bash
cd Backend
npm test                                              # MongoDB on 127.0.0.1:27017
TEST_MONGODB_URL=mongodb://127.0.0.1:27999 npm test   # any other server
```

On Windows PowerShell, set the variable with `$env:TEST_MONGODB_URL = "mongodb://..."` first.
The tests never read `Backend/.env`, so they can't touch your development or production database.

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull request:
- **Backend:** the test suites against a MongoDB 7 service, then `npm audit` of production dependencies
- **Frontend:** `npm run lint`, then `npm run build` (type-check and bundle), then `npm audit` of production dependencies

The audit steps fail on high or critical advisories.

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Tasks
- `GET /api/tasks` - Get all tasks (filtered by role)
- `GET /api/tasks/:id` - Get single task
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task (admin only)

### Users
- `GET /api/users` - Get all users (admin only)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin only)

### Attendance
- `GET /api/attendance` - Get attendance records
- `POST /api/attendance` - Create attendance record
- `POST /api/attendance/checkin` - Check-in
- `POST /api/attendance/checkout` - Check-out
- `PUT /api/attendance/:id` - Update attendance
- `DELETE /api/attendance/:id` - Delete attendance (admin only)

### Health
- `GET /api/health` - `200` when the server and database are up, `503` while the database is unreachable

### Contact
- `GET /api/contact` - Get all messages (admin only)
- `POST /api/contact` - Submit contact form
- `PUT /api/contact/:id` - Update message status
- `DELETE /api/contact/:id` - Delete message

## 🔐 Authentication & Authorization

### Sessions
1. User logs in with email/password (and optionally "remember me")
2. The server sets the session, a JWT, in the `pandav_session` cookie: `HttpOnly` (page scripts
   can't read it), `SameSite=Lax`, path `/api`, `Secure` over HTTPS. The token never appears in a
   response body or in browser storage
3. The browser sends the cookie with every API request; `protect` verifies it and attaches the user
4. On page load the app asks `GET /auth/me` who is signed in; logout is `POST /auth/logout`

"Remember me" keeps the cookie for `JWT_EXPIRE` (default 30 days). Without it the cookie ends
when the browser closes, and its token stops working after a day.

### How the browser reaches the API
The frontend always calls `/api` on its own domain, so the cookie is first-party in every
browser (Safari and iOS block cookies set by another site):
- **Production:** `Frontend/vercel.json` forwards `/api/*` to the Render backend
  (`https://pandav.onrender.com`) and adds the `ORIGIN_SECRET` header.
- **Development:** Vite forwards `/api` to `VITE_BACKEND_URL` (default `http://localhost:5000`).

Chat sockets can't go through Vercel's proxy, so they connect to the backend directly
(`VITE_BACKEND_URL`, set for production in `Frontend/.env.production`). Each connection first
gets a one-minute ticket from `POST /api/auth/socket-token`.

If the backend moves, update both `Frontend/vercel.json` and `Frontend/.env.production`.

### Deploying the cookie sessions
1. Generate a secret: `openssl rand -hex 32`.
2. Set `ORIGIN_SECRET` to it on **both** Render (backend) and Vercel (frontend), then redeploy
   both. If Render has it and Vercel doesn't (or the values differ), the API refuses every
   request. If neither has it, the app works but rate limits treat all visitors as one.
3. `CLIENT_URL` on Render must be the frontend's address (the API refuses posts from other origins).
4. Everyone is signed out once: tokens saved by the old version are no longer accepted.

### Role-Based Access Control
- **User Role**: Access to own tasks, attendance, and profile
- **Admin Role**: Full access to all features and data

### Protected Routes
Backend uses middleware to protect routes:
```javascript
router.get('/tasks', protect, getTasks);  // Requires authentication
router.delete('/tasks/:id', protect, authorize('admin'), deleteTask);  // Admin only
```

## 👤 Default Users

After setting up the database, run `node create-users.js` in `Backend/`. It creates an
admin (`admin@example.com`) and a regular user (`user@example.com`) and prints a random
password for each, once. Set `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` in `Backend/.env`
to choose them yourself.

Self-registration (`POST /api/auth/register`) always creates a regular user; the `role`
field is ignored. An admin can promote a user with `PUT /api/users/:id` and `{ "role": "admin" }`.

## ⬆️ Upgrading an Existing Database

After deploying a version that changes the data models, run the migration once against the
production database (it is safe to run again):

```bash
cd Backend
npm run migrate
```

It fills in new fields on existing records (attendance `day` and `approvalStatus`, per-assignee
task progress), replaces outdated indexes, and lists anything that needs a decision:

- **Duplicate attendance days**: a user with two records on one day. Delete all but one, then
  run the migration again so the one-record-per-day rule can be enforced by the database.
- **Data of deleted users**: run `npm run migrate -- --clean-orphans` to remove it.
- **Oversized profile images**: run `npm run migrate -- --drop-oversized-images` to clear them;
  those users can upload a new picture (the app now resizes uploads).

Attendance days follow `APP_TIMEZONE` (default `Asia/Kolkata`); set it in `Backend/.env` if
your team works in a different timezone.

## 🎨 Key Features Implementation

### Profile Picture Upload
- Images converted to base64 strings
- Stored directly in MongoDB
- Maximum size: 5MB
- Supported formats: All image types

### Task Filtering
- Users see only their assigned tasks
- Admins see all tasks with filtering options
- Filter by status: pending, in-progress, completed
- Filter by priority: low, medium, high

### Attendance Tracking
- Automatic work hours calculation
- Check-in/check-out with timestamps
- Status tracking: present, absent, late, half-day, leave
- Historical records with filtering

### Analytics Dashboard (Admin)
- Total tasks, completed tasks, pending tasks
- Task completion percentage
- Attendance rate
- Employee performance rankings
- Activity heatmap

## 🐛 Troubleshooting

### Backend Issues

**MongoDB Connection Error**
```bash
# Check if MongoDB is running
mongod --version

# Start MongoDB service
# Windows:
net start MongoDB

# Linux/Mac:
sudo systemctl start mongod
```

**Port Already in Use**
```bash
# Change PORT in .env file or kill the process
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -i :5000
kill -9 <PID>
```

### Frontend Issues

**Axios Network Error**
- Ensure backend is running on correct port
- Check CORS settings in backend
- Verify `VITE_BACKEND_URL` in `Frontend/.env` (default `http://localhost:5000`); the app calls
  `/api` on its own origin and Vite forwards it there

**Task/Attendance Not Displaying**
- Check browser console for errors
- Check the `pandav_session` cookie: DevTools → Application → Cookies (path `/api`)
- A 403 "Requests must come through the app" means `ORIGIN_SECRET` differs between Vercel and Render
- Check backend response format (should use `data` property)

## 📝 Development Tips

### Adding New Features

1. **Create Model** (Backend)
```javascript
// models/Feature.js
const featureSchema = new mongoose.Schema({
  // Define schema
});
```

2. **Create Controller** (Backend)
```javascript
// controllers/featureController.js
export const getFeatures = async (req, res) => {
  // Implementation
};
```

3. **Create Routes** (Backend)
```javascript
// routes/featureRoutes.js
router.get('/', protect, getFeatures);
```

4. **Create API Service** (Frontend)
```typescript
// api/featureAPI.ts
export const featureAPI = {
  getFeatures: async () => {
    const response = await api.get('/features');
    return response.data;
  },
};
```

5. **Create Component** (Frontend)
```tsx
// pages/Features.tsx
import { featureAPI } from '../api/featureAPI';
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 👨‍💻 Author

Pandav Development Team

## 🙏 Acknowledgments

- React.js team for the amazing library
- Express.js for the robust backend framework
- MongoDB for the flexible database
- TailwindCSS for the utility-first CSS framework

---

**Note**: This is a full-stack application designed for employee management. Make sure to properly secure your environment variables and JWT secrets in production environments.

For any issues or questions, please open an issue on the GitHub repository.
