# MERN Stack Backend

A robust backend API built with Express.js, MongoDB, and Node.js for the Pandav application.

## Features

- **Authentication & Authorization**: JWT-based authentication with role-based access control (admin/user)
- **User Management**: Complete CRUD operations for user profiles
- **Task Management**: Create, assign, and track tasks with priorities and status
- **Attendance System**: Check-in/check-out functionality with work hours calculation
- **Contact Management**: Handle contact form submissions
- **Secure**: Password hashing with bcrypt, protected routes, input validation

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - Database
- **Mongoose** - ODM for MongoDB
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing
- **CORS** - Cross-origin resource sharing

## Installation

1. Navigate to the Backend directory:
```bash
cd Backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configurations:
   - Set your MongoDB connection string
   - Set a secure JWT secret
   - Configure other environment variables as needed

## Running the Application

### Development Mode (with auto-restart):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

The server will start on `http://localhost:5000` (or your configured PORT).

## API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /register` - Register a new user
- `POST /login` - Login user
- `GET /me` - Get current user (Protected)
- `PUT /updatepassword` - Update password (Protected)

### User Routes (`/api/users`)
- `GET /` - Get all users (Admin only)
- `GET /:id` - Get single user (Protected)
- `PUT /:id` - Update user (Protected)
- `DELETE /:id` - Delete user (Admin only)
- `PUT /:id/toggle-active` - Activate/Deactivate user (Admin only)

### Task Routes (`/api/tasks`)
- `GET /` - Get all tasks (Protected)
- `POST /` - Create task (Admin only)
- `GET /:id` - Get single task (Protected)
- `PUT /:id` - Update task (Protected)
- `DELETE /:id` - Delete task (Admin only)

### Attendance Routes (`/api/attendance`)
- `GET /` - Get attendance records (Protected)
- `POST /` - Create attendance record (Protected)
- `GET /:id` - Get single attendance record (Protected)
- `PUT /:id` - Update attendance record (Protected)
- `DELETE /:id` - Delete attendance record (Admin only)
- `POST /checkin` - Check-in (Protected)
- `POST /checkout` - Check-out (Protected)

### Contact Routes (`/api/contact`)
- `GET /` - Get all contact messages (Admin only)
- `POST /` - Submit contact form (Public)
- `GET /:id` - Get single contact message (Admin only)
- `PUT /:id` - Update contact message status (Admin only)
- `DELETE /:id` - Delete contact message (Admin only)

## Models

### User Model
- name, email, password (hashed)
- role (user/admin)
- phone, department
- profileImage, isActive
- timestamps

### Task Model
- title, description
- assignedTo, createdBy (User references)
- status (pending/in-progress/completed/cancelled)
- priority (low/medium/high/urgent)
- dueDate, completedDate
- tags, notes
- timestamps

### Attendance Model
- user (User reference)
- date, status (present/absent/late/half-day/leave)
- checkInTime, checkOutTime
- workHours (auto-calculated)
- remarks, approvedBy
- timestamps

### Contact Model
- name, email, phone
- subject, message
- status (new/in-progress/resolved/closed)
- resolvedBy, resolvedAt
- timestamps

## Security Features

- Password hashing with bcryptjs
- JWT token authentication
- Protected routes with middleware
- Role-based authorization
- Input validation
- Unique constraints on sensitive fields

## Error Handling

The API returns JSON responses with the following structure:
```json
{
  "success": true/false,
  "data": {},
  "message": "Description"
}
```

## Development

For development, nodemon is configured to auto-restart the server on file changes:
```bash
npm run dev
```

## Environment Variables

Required environment variables (see `.env.example`):
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `JWT_EXPIRE` - JWT token expiration time

## License

ISC
