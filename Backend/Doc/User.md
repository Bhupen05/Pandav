# User Management & Authentication API Documentation

## Overview
The User Management and Authentication API provides endpoints for user registration, login, profile management, and admin user administration. Includes role-based access control with user and admin roles.

---

## User Schema

### User Model Structure

```javascript
{
  _id: ObjectId,
  
  // Basic Information
  name: String (required, trimmed),
  email: String (required, unique, lowercase, valid email),
  password: String (required, minlength: 6, hashed with bcrypt),
  
  // Role & Status
  role: String (enum: 'user', 'admin', default: 'user'),
  isActive: Boolean (default: true),
  
  // Profile Information
  phone: String (trimmed),
  department: String (trimmed),
  profileImage: String (URL to profile image),
  
  // Timestamps
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Password Security

- Passwords are hashed using bcrypt with salt rounds of 10
- Password field is selected: false by default (not returned in queries)
- Original password not stored, only hash comparison available

### Indexes

- `{ email: 1 }` (unique) - Ensures unique email addresses

---

## Authentication

Signing in sets a `pandav_session` cookie. Every protected endpoint reads the session from it;
the `Authorization` header is not used. The cookie is `HttpOnly` (page scripts can't read it),
`SameSite=Lax`, limited to the `/api` path, and `Secure` over HTTPS. Sign in once with curl and
reuse the cookie file:

```bash
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "..."}'

curl -b cookies.txt http://localhost:5000/api/auth/me
```

POST, PUT, PATCH and DELETE requests from a browser must come from an allowed origin
(`CLIENT_URL`); requests without an `Origin` header (curl, scripts) are allowed.

### Session Token

```
Format: JWT (HS256), audience "session"
Payload: { id: userId, remember: boolean }
Lifetime: JWT_EXPIRE (default 30 days) with "remember me", otherwise 1 day
```

Without `rememberMe` the cookie has no expiry date, so the browser drops it when it closes.

---

## API Endpoints

### 1. Register User

**Endpoint:** `POST /api/auth/register`

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phone": "+1-555-0100",
  "department": "Frontend",
  "profileImage": "https://example.com/john.jpg",
  "role": "user"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "createdAt": "2024-01-18T10:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "phone": "+1-555-0100",
    "department": "Frontend"
  }'
```

**Error Response (User Exists):**
```json
{
  "success": false,
  "message": "User already exists"
}
```

**Error Response (Invalid Email):**
```json
{
  "success": false,
  "message": "Please provide a valid email"
}
```

**Validation Rules:**
- Name is required
- Email must be unique and valid format
- Password minimum 6 characters
- Email is converted to lowercase

---

### 2. Login User

**Endpoint:** `POST /api/auth/login`

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123",
  "rememberMe": true
}
```

`rememberMe` (optional) keeps the session cookie after the browser closes. The response sets the
`pandav_session` cookie; the token is never in the response body.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "createdAt": "2024-01-18T10:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

**Error Response (Missing Credentials):**
```json
{
  "success": false,
  "message": "Please provide email and password"
}
```

**Error Response (Invalid Credentials):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

**Error Response (Account Deactivated):**
```json
{
  "success": false,
  "message": "Account is deactivated. Please contact admin."
}
```

---

### 3. Get Current User Profile

**Endpoint:** `GET /api/auth/me`

**Authentication:** Required (Private)

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "isActive": true,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T10:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/auth/me \
  -b cookies.txt
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

---

### 4. Update Password

**Endpoint:** `PUT /api/auth/updatepassword`

**Authentication:** Required (Private)

**Request Body:**
```json
{
  "currentPassword": "oldpassword123",
  "newPassword": "newpassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/auth/updatepassword \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "oldpassword123",
    "newPassword": "newpassword123"
  }'
```

**Error Response (Wrong Current Password):**
```json
{
  "success": false,
  "message": "Password is incorrect"
}
```

**Validation Rules:**
- Current password must be correct
- New password minimum 6 characters
- Sets a new session cookie (kept as long as the old one was); every other session of the user is signed out

---

### Sign Out

**Endpoint:** `POST /api/auth/logout`

**Authentication:** Not required. Clears the `pandav_session` cookie, even if the session has already expired.

**Response:** `{ "success": true }`

### Socket Ticket

**Endpoint:** `POST /api/auth/socket-token`

**Authentication:** Required (Private)

Returns a ticket for opening the Socket.io connection, valid for one minute:
`{ "success": true, "data": { "token": "..." } }`. Pass it as `auth: { token }` when connecting.
The socket server is reached directly (not through the frontend's `/api` proxy), so it never sees
the cookie. Fetch a new ticket for every connection attempt.

---

### 5. Get All Users

**Endpoint:** `GET /api/users`

**Authentication:** Required (Private)

**Authorization:** Admin only

**Query Parameters:**
- `role` (optional): Filter by role (user, admin)
- `department` (optional): Filter by department
- `isActive` (optional): Filter by status (true, false)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "phone": "+1-555-0100",
      "department": "Frontend",
      "profileImage": "https://example.com/john.jpg",
      "isActive": true,
      "createdAt": "2024-01-18T10:30:00.000Z",
      "updatedAt": "2024-01-18T10:30:00.000Z"
    },
    {
      "_id": "607f1f77bcf86cd799439015",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "role": "user",
      "phone": "+1-555-0101",
      "department": "Backend",
      "profileImage": "https://example.com/jane.jpg",
      "isActive": true,
      "createdAt": "2024-01-17T14:22:00.000Z",
      "updatedAt": "2024-01-17T14:22:00.000Z"
    },
    {
      "_id": "607f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin",
      "phone": "+1-555-0102",
      "department": "Management",
      "profileImage": "https://example.com/admin.jpg",
      "isActive": true,
      "createdAt": "2024-01-15T09:00:00.000Z",
      "updatedAt": "2024-01-15T09:00:00.000Z"
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET "http://localhost:5000/api/users?role=user&department=Frontend&isActive=true" \
  -b cookies.txt
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

---

### 6. Get Single User

**Endpoint:** `GET /api/users/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): User ID

**Authorization:** 
- Users can view only their own profile
- Admins can view any profile

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "isActive": true,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T10:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/users/607f1f77bcf86cd799439012 \
  -b cookies.txt
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "User not found"
}
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Not authorized to access this profile"
}
```

---

### 7. Update User Profile

**Endpoint:** `PUT /api/users/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): User ID

**Authorization:**
- Users can update only their own profile
- Admins can update any profile
- Non-admins cannot change their role

**Request Body (User Update):**
```json
{
  "name": "John Doe Updated",
  "phone": "+1-555-0200",
  "department": "Full Stack",
  "profileImage": "https://example.com/john-new.jpg"
}
```

**Request Body (Admin Update):**
```json
{
  "name": "John Doe Updated",
  "email": "john.new@example.com",
  "phone": "+1-555-0200",
  "department": "Full Stack",
  "role": "user",
  "profileImage": "https://example.com/john-new.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe Updated",
    "email": "john.new@example.com",
    "role": "user",
    "phone": "+1-555-0200",
    "department": "Full Stack",
    "profileImage": "https://example.com/john-new.jpg",
    "isActive": true,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T14:22:00.000Z"
  }
}
```

**Example Request (User):**
```bash
curl -X PUT http://localhost:5000/api/users/607f1f77bcf86cd799439012 \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe Updated",
    "phone": "+1-555-0200",
    "department": "Full Stack"
  }'
```

**Example Request (Admin):**
```bash
curl -X PUT http://localhost:5000/api/users/607f1f77bcf86cd799439012 \
  -b admin-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe Updated",
    "email": "john.new@example.com",
    "role": "user",
    "phone": "+1-555-0200"
  }'
```

**Important Notes:**
- Password cannot be updated through this route (use /updatepassword instead)
- Non-admin users cannot change their role
- Non-admin users cannot change email (admin only)

---

### 8. Toggle User Active Status

**Endpoint:** `PUT /api/users/:id/toggle-active`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): User ID

**Request Body:** Empty

```json
{}
```

**Response (Activate):**
```json
{
  "success": true,
  "message": "User activated successfully",
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "isActive": true,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T14:25:00.000Z"
  }
}
```

**Response (Deactivate):**
```json
{
  "success": true,
  "message": "User deactivated successfully",
  "data": {
    "_id": "607f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "phone": "+1-555-0100",
    "department": "Frontend",
    "profileImage": "https://example.com/john.jpg",
    "isActive": false,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T14:25:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/users/607f1f77bcf86cd799439012/toggle-active \
  -b admin-cookies.txt
```

**Effect:**
- If user was active, they become inactive
- If user was inactive, they become active
- Deactivated users cannot login
- Deactivated users cannot perform any actions

---

### 9. Delete User

**Endpoint:** `DELETE /api/users/:id`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): User ID

**Response:**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Example Request:**
```bash
curl -X DELETE http://localhost:5000/api/users/607f1f77bcf86cd799439012 \
  -b admin-cookies.txt
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "User not found"
}
```

**Error Response (Cannot Delete Self):**
```json
{
  "success": false,
  "message": "Cannot delete your own account"
}
```

**Important:** 
- Admins cannot delete their own account
- Permanently removes the user from the system

---

## User Roles & Permissions

### User Role

| Permission | Allowed |
|-----------|---------|
| View own profile | ✓ |
| Update own profile | ✓ |
| Change own password | ✓ |
| View own tasks | ✓ |
| Update own task progress | ✓ |
| View own attendance | ✓ |
| Check-in/Check-out | ✓ |
| View all users | ✗ |
| Create tasks | ✗ |
| Create attendance | ✗ |
| Approve tasks/attendance | ✗ |
| Delete users | ✗ |

### Admin Role

| Permission | Allowed |
|-----------|---------|
| View all profiles | ✓ |
| Update any profile | ✓ |
| Change any password | ✗ |
| View all tasks | ✓ |
| Create tasks | ✓ |
| Update any task | ✓ |
| Delete tasks | ✓ |
| Approve task completion | ✓ |
| View all attendance | ✓ |
| Create attendance | ✓ |
| Approve attendance | ✓ |
| Toggle user active status | ✓ |
| Delete users | ✓ |

---

## Authentication Flow

### Registration Flow

```
User submits registration form
    ↓
Validate email format
    ↓
Check if user already exists
    ↓
Hash password with bcrypt
    ↓
Create user record
    ↓
Return user data (the user signs in separately)
```

### Login Flow

```
User submits email & password
    ↓
Validate inputs
    ↓
Find user by email
    ↓
Compare password with hash
    ↓
Check if user is active
    ↓
Sign a session JWT and set it as the pandav_session cookie
    ↓
Return user data
```

### Protected Route Flow

```
Request with the pandav_session cookie
    ↓
Verify JWT token signature and audience
    ↓
Check token expiration
    ↓
Extract user ID from token
    ↓
Fetch user from database
    ↓
Attach user to request
    ↓
Proceed to route handler
```

---

## Password Security

### Hashing Algorithm

- **Algorithm**: bcrypt
- **Salt Rounds**: 10
- **Iteration Time**: ~100ms

### Password Requirements

- Minimum 6 characters
- Stored as hash only (original password never stored)
- Compared using bcrypt.compare() method

### Password Change

- Current password must be verified
- Cannot reuse same password immediately
- This browser gets a new session cookie; sessions issued before the change stop working
- New password takes effect immediately

---

## Token Management

### Token Generation

```javascript
jwt.sign({ id: userId, remember }, JWT_SECRET, { audience: 'session', expiresIn: remember ? JWT_EXPIRE : '1d' })
```

### Token Validation

- Verified against JWT_SECRET
- Checked for expiration
- User existence validated
- User active status checked

### Token Expiration

- With "remember me": JWT_EXPIRE (default 30 days); otherwise 1 day
- Expired tokens return 401 Unauthorized

---

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Please provide a valid email"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Not authorized to access this profile"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "User not found"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Internal server error message"
}
```

---

## Key Features

1. **Secure Authentication**: JWT-based token authentication with bcrypt password hashing
2. **Role-Based Access Control**: User and admin roles with different permissions
3. **User Profile Management**: Complete user profile with department and contact information
4. **Account Deactivation**: Admins can deactivate accounts without deleting data
5. **Password Management**: Secure password update with current password verification
6. **Profile Pictures**: Support for profile image URLs
7. **User Filtering**: Admin can filter users by role, department, and active status
8. **Account Security**: Deactivated users cannot login or perform actions
9. **Audit Trail**: Automatic timestamps for user creation and updates

---

## Best Practices

1. **Session Storage**: The session lives in an HttpOnly cookie; never copy it into browser storage
2. **Validate Input**: Always validate email format and password requirements
3. **Use HTTPS**: Always transmit tokens over HTTPS
4. **Token Expiration**: Implement token refresh mechanism for long sessions
5. **Password Security**: Enforce strong password policies
6. **Account Management**: Regularly review active user accounts
7. **Role Management**: Carefully assign admin roles
8. **Deactivation**: Use deactivation instead of deletion for data integrity
9. **Audit Logging**: Log user activity for security monitoring
10. **Error Messages**: Don't expose sensitive information in error messages

---

## Integration Notes

- **Email Validation**: Uses validator.js for email format validation
- **Password Hashing**: Automatically hashed before saving to database
- **User Population**: User references in other collections auto-populate user details
- **Timestamps**: Automatic creation and update times recorded
- **Database Indexes**: Optimized unique email constraint
- **Password Field**: Hidden by default in queries (select: false)

