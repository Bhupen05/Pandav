# Attendance Management API Documentation

## Overview
The Attendance Management API provides endpoints to track employee attendance with check-in/check-out functionality, work hours calculation, and admin approval workflow.

---

## Attendance Schema

### Attendance Model Structure

```javascript
{
  _id: ObjectId,
  
  // User Reference
  user: ObjectId (required, User ID),
  
  // Date & Time Tracking
  date: Date (required, default: current date),
  checkInTime: Date,
  checkOutTime: Date,
  
  // Work Information
  status: String (enum: 'present', 'absent', 'late', 'half-day', 'leave'),
  workHours: Number (auto-calculated, default: 0),
  
  // Approval
  approvedBy: ObjectId (User ID of approver),
  remarks: String (trimmed),
  
  // Timestamps
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Indexes

- `{ user: 1, date: 1 }` (unique) - Ensures one attendance record per user per day
- Automatically calculated `workHours` = (checkOutTime - checkInTime) / 3600000 hours

---

## API Endpoints

### 1. Get All Attendance Records

**Endpoint:** `GET /api/attendance`

**Authentication:** Required (Private)

**Query Parameters:**
- `user` (optional): Filter by user ID
- `status` (optional): Filter by attendance status (present, absent, late, half-day, leave)
- `startDate` (optional): Filter from date (ISO format)
- `endDate` (optional): Filter to date (ISO format)

**Authorization:** Regular users can view only their own records. Admins can view all records.

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "607f1f77bcf86cd799439011",
      "user": {
        "_id": "607f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com",
        "department": "Frontend",
        "profileImage": "https://example.com/image.jpg"
      },
      "date": "2024-01-18T00:00:00.000Z",
      "status": "present",
      "checkInTime": "2024-01-18T09:00:00.000Z",
      "checkOutTime": "2024-01-18T17:30:00.000Z",
      "workHours": 8.5,
      "remarks": "Regular day",
      "approvedBy": {
        "_id": "607f1f77bcf86cd799439013",
        "name": "Admin User",
        "email": "admin@example.com"
      },
      "createdAt": "2024-01-18T09:00:00.000Z",
      "updatedAt": "2024-01-18T17:30:00.000Z"
    },
    {
      "_id": "607f1f77bcf86cd799439014",
      "user": {
        "_id": "607f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com",
        "department": "Frontend",
        "profileImage": "https://example.com/image.jpg"
      },
      "date": "2024-01-17T00:00:00.000Z",
      "status": "late",
      "checkInTime": "2024-01-17T10:15:00.000Z",
      "checkOutTime": "2024-01-17T18:00:00.000Z",
      "workHours": 7.75,
      "remarks": "Traffic delay",
      "approvedBy": null,
      "createdAt": "2024-01-17T10:15:00.000Z",
      "updatedAt": "2024-01-17T18:00:00.000Z"
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET "http://localhost:5000/api/attendance?status=present&startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Get Single Attendance Record

**Endpoint:** `GET /api/attendance/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): Attendance record ID

**Authorization:** Only the user themselves or admins can access a record.

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439011",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-18T00:00:00.000Z",
    "status": "present",
    "checkInTime": "2024-01-18T09:00:00.000Z",
    "checkOutTime": "2024-01-18T17:30:00.000Z",
    "workHours": 8.5,
    "remarks": "Regular working day",
    "approvedBy": {
      "_id": "607f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "createdAt": "2024-01-18T09:00:00.000Z",
    "updatedAt": "2024-01-18T17:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/attendance/607f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "Attendance record not found"
}
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Not authorized to access this record"
}
```

---

### 3. Check-In

**Endpoint:** `POST /api/attendance/checkin`

**Authentication:** Required (Private)

**Authorization:** All logged-in users

**Request Body:** Empty or optional location data

```json
{}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439015",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-19T00:00:00.000Z",
    "status": "present",
    "checkInTime": "2024-01-19T09:05:30.000Z",
    "checkOutTime": null,
    "workHours": 0,
    "remarks": null,
    "approvedBy": null,
    "createdAt": "2024-01-19T09:05:30.000Z",
    "updatedAt": "2024-01-19T09:05:30.000Z"
  }
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/api/attendance/checkin \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Error Response (Already Checked In):**
```json
{
  "success": false,
  "message": "Already checked in today"
}
```

---

### 4. Check-Out

**Endpoint:** `POST /api/attendance/checkout`

**Authentication:** Required (Private)

**Authorization:** All logged-in users

**Request Body:** Empty

```json
{}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439015",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-19T00:00:00.000Z",
    "status": "present",
    "checkInTime": "2024-01-19T09:05:30.000Z",
    "checkOutTime": "2024-01-19T17:45:15.000Z",
    "workHours": 8.67,
    "remarks": null,
    "approvedBy": null,
    "createdAt": "2024-01-19T09:05:30.000Z",
    "updatedAt": "2024-01-19T17:45:15.000Z"
  }
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/api/attendance/checkout \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Error Response (No Check-In Found):**
```json
{
  "success": false,
  "message": "No check-in record found for today"
}
```

**Error Response (Already Checked Out):**
```json
{
  "success": false,
  "message": "Already checked out today"
}
```

---

### 5. Create Attendance Record

**Endpoint:** `POST /api/attendance`

**Authentication:** Required (Private)

**Authorization:** 
- **Admins**: Can create records for any user
- **Regular Users**: Can only create records for themselves

**Request Body:**
```json
{
  "user": "607f1f77bcf86cd799439012",
  "date": "2024-01-18T00:00:00Z",
  "status": "present",
  "checkInTime": "2024-01-18T09:00:00Z",
  "checkOutTime": "2024-01-18T17:30:00Z",
  "remarks": "Regular working day"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439011",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-18T00:00:00.000Z",
    "status": "present",
    "checkInTime": "2024-01-18T09:00:00.000Z",
    "checkOutTime": "2024-01-18T17:30:00.000Z",
    "workHours": 8.5,
    "remarks": "Regular working day",
    "approvedBy": null,
    "createdAt": "2024-01-18T10:30:00.000Z",
    "updatedAt": "2024-01-18T10:30:00.000Z"
  }
}
```

**Example Request (Admin):**
```bash
curl -X POST http://localhost:5000/api/attendance \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "607f1f77bcf86cd799439012",
    "date": "2024-01-18T00:00:00Z",
    "status": "present",
    "checkInTime": "2024-01-18T09:00:00Z",
    "checkOutTime": "2024-01-18T17:30:00Z"
  }'
```

**Error Response (Duplicate Record):**
```json
{
  "success": false,
  "message": "Attendance already recorded for this user today"
}
```

---

### 6. Update Attendance Record

**Endpoint:** `PUT /api/attendance/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): Attendance record ID

**Authorization:**
- **Admins**: Can update all fields
- **Regular Users**: Can only update `status` and `remarks` fields

**Request Body (Admin Update):**
```json
{
  "status": "late",
  "checkInTime": "2024-01-18T10:15:00Z",
  "remarks": "Traffic delay - unavoidable"
}
```

**Request Body (User Update):**
```json
{
  "status": "present",
  "remarks": "Work completed successfully"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "607f1f77bcf86cd799439011",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-18T00:00:00.000Z",
    "status": "late",
    "checkInTime": "2024-01-18T10:15:00.000Z",
    "checkOutTime": "2024-01-18T17:30:00.000Z",
    "workHours": 7.25,
    "remarks": "Traffic delay - unavoidable",
    "approvedBy": {
      "_id": "607f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "updatedAt": "2024-01-18T14:22:00.000Z"
  }
}
```

**Example Request (Admin):**
```bash
curl -X PUT http://localhost:5000/api/attendance/607f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "late",
    "remarks": "Traffic delay"
  }'
```

**Example Request (User):**
```bash
curl -X PUT http://localhost:5000/api/attendance/607f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "present",
    "remarks": "Work completed"
  }'
```

---

### 7. Approve Attendance

**Endpoint:** `PUT /api/attendance/:id/approve`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Attendance record ID

**Request Body:**
```json
{
  "remarks": "Approved - All documents verified"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Attendance approved successfully",
  "data": {
    "_id": "607f1f77bcf86cd799439011",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-18T00:00:00.000Z",
    "status": "present",
    "checkInTime": "2024-01-18T09:00:00.000Z",
    "checkOutTime": "2024-01-18T17:30:00.000Z",
    "workHours": 8.5,
    "remarks": "Approved - All documents verified",
    "approvedBy": {
      "_id": "607f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "updatedAt": "2024-01-18T14:25:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/attendance/607f1f77bcf86cd799439011/approve \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "remarks": "Approved - All documents verified"
  }'
```

---

### 8. Disapprove Attendance

**Endpoint:** `PUT /api/attendance/:id/disapprove`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Attendance record ID

**Request Body:**
```json
{
  "remarks": "Missing required documents - Please resubmit"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Attendance disapproved successfully",
  "data": {
    "_id": "607f1f77bcf86cd799439011",
    "user": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com",
      "department": "Frontend",
      "profileImage": "https://example.com/image.jpg"
    },
    "date": "2024-01-18T00:00:00.000Z",
    "status": "absent",
    "checkInTime": "2024-01-18T09:00:00.000Z",
    "checkOutTime": "2024-01-18T17:30:00.000Z",
    "workHours": 8.5,
    "remarks": "Missing required documents - Please resubmit",
    "approvedBy": null,
    "updatedAt": "2024-01-18T14:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/attendance/607f1f77bcf86cd799439011/disapprove \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "remarks": "Missing required documents"
  }'
```

---

### 9. Get Pending Attendance Records

**Endpoint:** `GET /api/attendance/pending`

**Authentication:** Required (Private)

**Authorization:** Admin only

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "607f1f77bcf86cd799439011",
      "user": {
        "_id": "607f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com",
        "department": "Frontend",
        "profileImage": "https://example.com/image.jpg"
      },
      "date": "2024-01-18T00:00:00.000Z",
      "status": "late",
      "checkInTime": "2024-01-18T10:15:00.000Z",
      "checkOutTime": "2024-01-18T17:30:00.000Z",
      "workHours": 7.25,
      "remarks": "Traffic delay",
      "approvedBy": null,
      "createdAt": "2024-01-18T10:30:00.000Z",
      "updatedAt": "2024-01-18T10:30:00.000Z"
    },
    {
      "_id": "607f1f77bcf86cd799439014",
      "user": {
        "_id": "607f1f77bcf86cd799439015",
        "name": "Jane Smith",
        "email": "jane@example.com",
        "department": "Backend",
        "profileImage": "https://example.com/image.jpg"
      },
      "date": "2024-01-18T00:00:00.000Z",
      "status": "half-day",
      "checkInTime": "2024-01-18T09:00:00.000Z",
      "checkOutTime": "2024-01-18T13:00:00.000Z",
      "workHours": 4,
      "remarks": "Medical appointment",
      "approvedBy": null,
      "createdAt": "2024-01-18T13:15:00.000Z",
      "updatedAt": "2024-01-18T13:15:00.000Z"
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/attendance/pending \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 10. Delete Attendance Record

**Endpoint:** `DELETE /api/attendance/:id`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Attendance record ID

**Response:**
```json
{
  "success": true,
  "message": "Attendance record deleted successfully"
}
```

**Example Request:**
```bash
curl -X DELETE http://localhost:5000/api/attendance/607f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "Attendance record not found"
}
```

---

## Attendance Status Types

| Status | Description | Usage |
|--------|-------------|-------|
| **present** | Employee worked full day | Standard attendance |
| **absent** | Employee did not show up | No work hours |
| **late** | Employee arrived late | Work hours calculated |
| **half-day** | Employee worked half day | Reduced work hours |
| **leave** | Employee took approved leave | No work hours |

---

## Work Hours Calculation

Work hours are automatically calculated when both `checkInTime` and `checkOutTime` are present:

```
workHours = (checkOutTime - checkInTime) / (1000 * 60 * 60)
```

**Examples:**
- Check-in: 09:00, Check-out: 17:30 = 8.5 hours
- Check-in: 10:15, Check-out: 17:30 = 7.25 hours
- Check-in: 09:00, Check-out: 13:00 = 4 hours

---

## Approval Workflow

### Check-In/Check-Out Flow

```
Check-In (automatic present status)
    ↓
Check-Out (workHours calculated)
    ↓
Pending Approval (approvedBy = null)
    ↓
Admin Approval/Disapproval
    ↓
Final Status
```

### Manual Record Flow

```
Create Record
    ↓
Pending Approval
    ↓
Admin Review
    ↓
Approve → Status confirmed, approvedBy set
Disapprove → Status changed to absent, approvedBy cleared
```

---

## Authentication

All endpoints require a bearer token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Attendance status is required"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Not authorized to access this record"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "Attendance record not found"
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

1. **Automatic Check-In/Out**: Quick check-in/out with automatic timestamp recording
2. **Work Hours Calculation**: Automatic calculation of daily work hours
3. **One Record Per Day**: Unique constraint ensures one attendance record per user per day
4. **Admin Approval Workflow**: All attendance records pending admin approval
5. **Flexible Status Management**: Multiple status types for different scenarios
6. **Date Range Filtering**: Query records by date ranges
7. **User Restrictions**: Regular users can only manage their own records
8. **Remarks Tracking**: Admin can add notes/remarks to records

---

## Best Practices

1. **Always Check-In First**: Ensure check-in is done before check-out
2. **Complete Check-Out**: Always check-out to record complete work day
3. **Add Remarks**: Include remarks for late arrivals or special cases
4. **Admin Review**: Regularly review pending attendance records
5. **Time Accuracy**: Ensure system time is synchronized across devices
6. **Archive Old Records**: Maintain database performance by archiving old records
7. **Monitor Patterns**: Track attendance patterns for management insights
8. **Handle Edge Cases**: Use manual record creation for special scenarios

---

## Integration Notes

- **User Population**: Attendance records auto-populate user details (name, email, department)
- **Approver Tracking**: Track which admin approved the record
- **Timestamps**: Both creation and update times are automatically recorded
- **Data Validation**: Server validates all required fields before saving
- **Database Indexes**: Optimized queries for user and date filters
