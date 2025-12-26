# Task Management API Documentation

## Overview
The Task Management API provides endpoints to create, retrieve, update, and manage tasks with support for multiple assignees, progress tracking, and a completion approval workflow.

---

## Task Schema

### Task Model Structure

```javascript
{
  _id: ObjectId,
  
  // Basic Information
  title: String (required, trimmed),
  description: String (required),
  
  // Assignment
  assignedTo: [ObjectId] (required, array of User IDs),
  createdBy: ObjectId (required, User ID),
  
  // Status & Priority
  status: String (enum: 'pending', 'in-progress', 'completed', 'cancelled', 'completion-requested'),
  priority: String (enum: 'low', 'medium', 'high', 'urgent'),
  
  // Dates
  startDate: Date (required),
  dueDate: Date (required),
  estimatedDays: Number (default: 1),
  
  // Completion Workflow
  completionRequestedBy: ObjectId,
  completionRequestedAt: Date,
  completedDate: Date,
  approvedBy: ObjectId,
  
  // Progress Tracking per Assignee
  assigneeProgress: [
    {
      user: ObjectId (User ID),
      status: String (enum: 'not-started', 'in-progress', 'completed', 'completion-requested'),
      completionRequestedAt: Date,
      notes: String
    }
  ],
  
  // Additional Fields
  tags: [String] (trimmed),
  notes: String,
  
  // Timestamps
  createdAt: Date (auto),
  updatedAt: Date (auto)
}
```

### Virtual Properties

- **durationInDays**: Automatically calculated as `Math.ceil((dueDate - startDate) / (1000 * 60 * 60 * 24)) + 1`

### Indexes

- `{ assignedTo: 1, status: 1 }` - For efficient filtering by assignees and status
- `{ createdBy: 1 }` - For finding tasks created by a user
- `{ status: 1 }` - For status-based queries

---

## API Endpoints

### 1. Get All Tasks

**Endpoint:** `GET /api/tasks`

**Authentication:** Required (Private)

**Query Parameters:**
- `status` (optional): Filter by task status (pending, in-progress, completed, cancelled, completion-requested)
- `priority` (optional): Filter by priority (low, medium, high, urgent)
- `assignedTo` (optional): Filter by assigned user ID

**Authorization:** All users can view their assigned tasks. Admins can view all tasks.

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "title": "Website Redesign",
      "description": "Complete redesign of landing page",
      "assignedTo": [
        {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        }
      ],
      "createdBy": {
        "_id": "507f1f77bcf86cd799439013",
        "name": "Admin User",
        "email": "admin@example.com"
      },
      "status": "in-progress",
      "priority": "high",
      "startDate": "2024-01-15T00:00:00.000Z",
      "dueDate": "2024-01-25T00:00:00.000Z",
      "estimatedDays": 10,
      "assigneeProgress": [
        {
          "_id": "507f1f77bcf86cd799439014",
          "user": {
            "_id": "507f1f77bcf86cd799439012",
            "name": "John Doe",
            "email": "john@example.com"
          },
          "status": "in-progress",
          "notes": "Working on UI components"
        }
      ],
      "tags": ["frontend", "design"],
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-18T14:22:00.000Z"
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/tasks?status=in-progress&priority=high \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Get Single Task

**Endpoint:** `GET /api/tasks/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): Task ID

**Authorization:** Only assigned users or admins can access a task.

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "title": "Website Redesign",
    "description": "Complete redesign of landing page",
    "assignedTo": [
      {
        "_id": "507f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com",
        "department": "Frontend"
      }
    ],
    "createdBy": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "status": "in-progress",
    "priority": "high",
    "startDate": "2024-01-15T00:00:00.000Z",
    "dueDate": "2024-01-25T00:00:00.000Z",
    "estimatedDays": 10,
    "durationInDays": 11,
    "assigneeProgress": [
      {
        "_id": "507f1f77bcf86cd799439014",
        "user": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "status": "in-progress",
        "completionRequestedAt": null,
        "notes": "Working on UI components"
      }
    ],
    "tags": ["frontend", "design"],
    "notes": "This is a high-priority task",
    "completionRequestedBy": null,
    "completionRequestedAt": null,
    "completedDate": null,
    "approvedBy": null,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-18T14:22:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/tasks/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "Task not found"
}
```

**Error Response (Unauthorized):**
```json
{
  "success": false,
  "message": "Not authorized to access this task"
}
```

---

### 3. Create Task

**Endpoint:** `POST /api/tasks`

**Authentication:** Required (Private)

**Authorization:** Admin only

**Request Body:**
```json
{
  "title": "Website Redesign",
  "description": "Complete redesign of landing page with modern UI",
  "assignedTo": ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439015"],
  "priority": "high",
  "startDate": "2024-01-15T00:00:00Z",
  "dueDate": "2024-01-25T00:00:00Z",
  "estimatedDays": 10,
  "tags": ["frontend", "design"],
  "notes": "Coordinate with design team"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "title": "Website Redesign",
    "description": "Complete redesign of landing page with modern UI",
    "assignedTo": [
      {
        "_id": "507f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com"
      },
      {
        "_id": "507f1f77bcf86cd799439015",
        "name": "Jane Smith",
        "email": "jane@example.com"
      }
    ],
    "createdBy": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "status": "pending",
    "priority": "high",
    "startDate": "2024-01-15T00:00:00.000Z",
    "dueDate": "2024-01-25T00:00:00.000Z",
    "estimatedDays": 10,
    "assigneeProgress": [
      {
        "user": "507f1f77bcf86cd799439012",
        "status": "not-started"
      },
      {
        "user": "507f1f77bcf86cd799439015",
        "status": "not-started"
      }
    ],
    "tags": ["frontend", "design"],
    "notes": "Coordinate with design team",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/api/tasks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Website Redesign",
    "description": "Complete redesign of landing page",
    "assignedTo": ["507f1f77bcf86cd799439012"],
    "priority": "high",
    "startDate": "2024-01-15T00:00:00Z",
    "dueDate": "2024-01-25T00:00:00Z",
    "tags": ["frontend", "design"]
  }'
```

**Error Response (Validation Failed):**
```json
{
  "success": false,
  "message": "Task title is required"
}
```

---

### 4. Update Task

**Endpoint:** `PUT /api/tasks/:id`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): Task ID

**Authorization:** 
- **Admins**: Can update all task fields
- **Regular Users**: Can only update their own progress (status and notes in assigneeProgress)

**Request Body (Admin Update):**
```json
{
  "title": "Website Redesign - Phase 2",
  "description": "Updated description",
  "priority": "urgent",
  "dueDate": "2024-01-30T00:00:00Z",
  "tags": ["frontend", "design", "urgent"]
}
```

**Request Body (User Progress Update):**
```json
{
  "status": "in-progress",
  "notes": "Started working on header component"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "title": "Website Redesign - Phase 2",
    "description": "Updated description",
    "priority": "urgent",
    "dueDate": "2024-01-30T00:00:00.000Z",
    "assigneeProgress": [
      {
        "user": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "status": "in-progress",
        "notes": "Started working on header component"
      }
    ],
    "updatedAt": "2024-01-18T14:22:00.000Z"
  }
}
```

**Example Request (Admin):**
```bash
curl -X PUT http://localhost:5000/api/tasks/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "urgent",
    "title": "Website Redesign - Phase 2"
  }'
```

**Example Request (User Progress):**
```bash
curl -X PUT http://localhost:5000/api/tasks/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress",
    "notes": "Working on UI components"
  }'
```

---

### 5. Request Task Completion

**Endpoint:** `POST /api/tasks/:id/request-completion`

**Authentication:** Required (Private)

**URL Parameters:**
- `id` (required): Task ID

**Authorization:** Only assigned users can request completion

**Request Body:**
```json
{
  "notes": "Task is complete and ready for review"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task completion requested for admin approval",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "completion-requested",
    "completionRequestedBy": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "completionRequestedAt": "2024-01-24T14:22:00.000Z",
    "assigneeProgress": [
      {
        "user": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "status": "completion-requested",
        "completionRequestedAt": "2024-01-24T14:22:00.000Z",
        "notes": "Task is complete and ready for review"
      }
    ]
  }
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/api/tasks/507f1f77bcf86cd799439011/request-completion \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Task is complete and ready for review"
  }'
```

**Note:** If all assigned users request completion, the task status automatically changes to "completion-requested".

---

### 6. Approve Task Completion

**Endpoint:** `PUT /api/tasks/:id/approve`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Task ID

**Request Body:** Empty or optional

```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Task completion approved successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "completed",
    "completedDate": "2024-01-24T14:25:00.000Z",
    "approvedBy": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Admin User",
      "email": "admin@example.com"
    },
    "assigneeProgress": [
      {
        "user": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "status": "completed"
      }
    ]
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/tasks/507f1f77bcf86cd799439011/approve \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Error Response (Invalid State):**
```json
{
  "success": false,
  "message": "Task completion has not been requested"
}
```

---

### 7. Reject Task Completion

**Endpoint:** `PUT /api/tasks/:id/reject`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Task ID

**Request Body:**
```json
{
  "rejectionReason": "Need to fix the following issues: 1. Header layout, 2. Footer styling"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task completion rejected",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "in-progress",
    "notes": "Need to fix the following issues: 1. Header layout, 2. Footer styling",
    "completionRequestedBy": null,
    "completionRequestedAt": null,
    "assigneeProgress": [
      {
        "user": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        },
        "status": "in-progress",
        "completionRequestedAt": null
      }
    ]
  }
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/api/tasks/507f1f77bcf86cd799439011/reject \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rejectionReason": "Need to fix the header layout"
  }'
```

---

### 8. Get Pending Approval Tasks

**Endpoint:** `GET /api/tasks/pending-approval`

**Authentication:** Required (Private)

**Authorization:** Admin only

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "title": "Website Redesign",
      "description": "Complete redesign of landing page",
      "status": "completion-requested",
      "priority": "high",
      "completionRequestedBy": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "completionRequestedAt": "2024-01-24T14:22:00.000Z",
      "assignedTo": [
        {
          "_id": "507f1f77bcf86cd799439012",
          "name": "John Doe",
          "email": "john@example.com"
        }
      ],
      "createdBy": {
        "_id": "507f1f77bcf86cd799439013",
        "name": "Admin User",
        "email": "admin@example.com"
      },
      "assigneeProgress": [
        {
          "user": {
            "_id": "507f1f77bcf86cd799439012",
            "name": "John Doe",
            "email": "john@example.com"
          },
          "status": "completion-requested"
        }
      ]
    }
  ]
}
```

**Example Request:**
```bash
curl -X GET http://localhost:5000/api/tasks/pending-approval \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 9. Delete Task

**Endpoint:** `DELETE /api/tasks/:id`

**Authentication:** Required (Private)

**Authorization:** Admin only

**URL Parameters:**
- `id` (required): Task ID

**Response:**
```json
{
  "success": true,
  "message": "Task deleted successfully"
}
```

**Example Request:**
```bash
curl -X DELETE http://localhost:5000/api/tasks/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Error Response (Not Found):**
```json
{
  "success": false,
  "message": "Task not found"
}
```

---

## Status Workflow

### Task Status Flow

```
pending → in-progress → completion-requested → completed
   ↓           ↓              ↓
cancelled  in-progress     in-progress
```

### Individual Assignee Progress

```
not-started → in-progress → completion-requested → completed
                    ↓              ↓
                 in-progress   in-progress
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
  "message": "Task title is required"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Not authorized to update this task"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "Task not found"
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

1. **Multiple Assignees**: A task can be assigned to multiple users
2. **Individual Progress Tracking**: Each assignee's progress is tracked separately
3. **Completion Workflow**: Tasks go through a completion-request → approval workflow
4. **Role-based Access**: Regular users and admins have different permissions
5. **Date Tracking**: Automatic calculation of task duration
6. **Task Filtering**: Filter tasks by status, priority, and assignees
7. **Timestamps**: Automatic creation and update timestamps

---

## Best Practices

1. Always include proper authentication tokens in requests
2. Validate date ranges (startDate should be before dueDate)
3. Use query parameters to filter large task lists
4. Check task status before performing status-specific actions
5. Monitor completion request workflow for timely approvals
6. Use tags for better task organization and filtering
