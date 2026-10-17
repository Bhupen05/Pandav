# Frontend V2 Implementation Guide - Feature Development

A step-by-step guide for implementing new features in the Pandav Frontend using the V2 API backend.

---

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Adding a New API Endpoint](#adding-a-new-api-endpoint)
3. [Adding a New Page Component](#adding-a-new-page-component)
4. [Implementing Common Features](#implementing-common-features)
5. [Handling Errors & Loading States](#handling-errors--loading-states)
6. [Real-Time Updates with Socket.IO](#real-time-updates-with-socketio)
7. [Testing Your Implementation](#testing-your-implementation)

---

## Before You Start

### Required Knowledge

- React Hooks (useState, useEffect, useContext)
- TypeScript basics (interfaces, types)
- Async/await and Promise handling
- REST API concepts (GET, POST, PUT, DELETE, PATCH)

### File Structure Review

```
Frontend/src/
├── api/              # API client functions
│   ├── axios.ts      # HTTP client configuration
│   ├── authAPI.ts
│   ├── socialV2API.ts
│   ├── taskAPI.ts
│   ├── teamAPI.ts
│   ├── chatAPI.ts
│   └── ...
├── context/          # Global state (Auth, Chat)
├── pages/            # Page components
└── components/       # Reusable components
```

### Before Starting Development

1. **Verify Backend API Exists**
   - Check [Backend FRONTEND_V2_PAGES_API.md](Backend/FRONTEND_V2_PAGES_API.md)
   - Test endpoint with Postman/Bruno
   - Verify response structure

2. **Check Authentication Status**
   - Is this endpoint protected?
   - What roles are allowed?
   - Is token handling needed?

3. **Review Existing Similar Features**
   - Look at Tasks page for task management patterns
   - Look at ChatPage for real-time update patterns
   - Look at SocialHub for complex multi-section patterns

---

## Adding a New API Endpoint

### Step 1: Create/Update API File

If adding to an existing module:

```typescript
// src/api/taskAPI.ts
export const taskAPI = {
  // Existing endpoints...
  
  // New endpoint
  getTaskDetails: async (taskId: string) => {
    const response = await api.get(`/tasks/${taskId}/details`);
    return response.data;
  },

  updateTaskStatus: async (taskId: string, status: string) => {
    const response = await api.put(`/tasks/${taskId}/status`, { status });
    return response.data;
  },
};
```

### Step 2: Add TypeScript Types

Define the response shapes:

```typescript
// At top of API file
interface TaskDetails {
  _id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed';
  assignedUser?: {
    _id: string;
    name: string;
    email: string;
  };
  dueDate?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export const taskAPI = {
  getTaskDetails: async (taskId: string): Promise<TaskDetails> => {
    const response = await api.get(`/tasks/${taskId}/details`);
    return response.data;
  },
};
```

### Step 3: Use in Components

```typescript
import { taskAPI } from '../api/taskAPI';

export const TaskDetails = ({ taskId }: { taskId: string }) => {
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTask = async () => {
      try {
        setLoading(true);
        const data = await taskAPI.getTaskDetails(taskId);
        setTask(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [taskId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!task) return <div>Task not found</div>;

  return (
    <div>
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <p>Status: {task.status}</p>
      <p>Priority: {task.priority}</p>
    </div>
  );
};
```

---

## Adding a New Page Component

### Step 1: Create Page File

```typescript
// src/pages/TaskDetails.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { taskAPI } from '../api/taskAPI';

interface Task {
  _id: string;
  title: string;
  description: string;
  // ... other fields
}

export default function TaskDetails() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const { isAuthenticated } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!taskId) {
      navigate('/tasks');
      return;
    }

    const loadTask = async () => {
      try {
        setLoading(true);
        const data = await taskAPI.getTaskDetails(taskId);
        setTask(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [taskId, isAuthenticated, navigate]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!task) return <div className="p-4">Task not found</div>;

  return (
    <div className="p-4">
      <h1>{task.title}</h1>
      <p>{task.description}</p>
      {/* More content */}
    </div>
  );
}
```

### Step 2: Add Route in App.tsx

```typescript
// src/App.tsx
import TaskDetails from './pages/TaskDetails';

function AppRoutes() {
  return (
    <Routes>
      {/* Existing routes */}
      <Route path="/tasks/:taskId" element={<TaskDetails />} />
      {/* More routes */}
    </Routes>
  );
}
```

### Step 3: Add Navigation Link

```typescript
// In Navbar or relevant navigation component
<Link to={`/tasks/${taskId}`}>View Details</Link>
```

---

## Implementing Common Features

### 1. List with Pagination

```typescript
import { useEffect, useState } from 'react';
import { taskAPI } from '../api/taskAPI';

interface ListState {
  items: any[];
  currentPage: number;
  pageSize: number;
  total: number;
  loading: boolean;
  error: string | null;
}

export const TaskList = () => {
  const [state, setState] = useState<ListState>({
    items: [],
    currentPage: 1,
    pageSize: 10,
    total: 0,
    loading: false,
    error: null,
  });

  const loadPage = async (page: number) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const offset = (page - 1) * state.pageSize;
      const data = await taskAPI.getTasks({ 
        limit: state.pageSize, 
        offset 
      });
      setState(prev => ({
        ...prev,
        items: data.items,
        total: data.total,
        currentPage: page,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load',
      }));
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    loadPage(1);
  }, []);

  const totalPages = Math.ceil(state.total / state.pageSize);

  return (
    <div>
      {state.error && <div className="error">{state.error}</div>}
      
      <div>
        {state.items.map(item => (
          <div key={item._id}>{item.title}</div>
        ))}
      </div>

      <div className="pagination">
        <button 
          onClick={() => loadPage(state.currentPage - 1)}
          disabled={state.currentPage === 1 || state.loading}
        >
          Previous
        </button>
        <span>{state.currentPage} / {totalPages}</span>
        <button 
          onClick={() => loadPage(state.currentPage + 1)}
          disabled={state.currentPage === totalPages || state.loading}
        >
          Next
        </button>
      </div>
    </div>
  );
};
```

### 2. Modal/Dialog Form

```typescript
import { useState } from 'react';
import { socialV2API } from '../api/socialV2API';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: () => void;
}

export const CreatePostModal = ({ 
  isOpen, 
  onClose, 
  onPostCreated 
}: CreatePostModalProps) => {
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'team' | 'connections'>('public');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await socialV2API.createPost({
        content,
        visibility,
        targets: { pandav: true },
      });
      
      setContent('');
      setVisibility('public');
      onPostCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create post');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Create Post</h2>
        <form onSubmit={handleSubmit}>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
          />
          
          <select 
            value={visibility} 
            onChange={e => setVisibility(e.target.value as any)}
          >
            <option value="public">Public</option>
            <option value="team">Team Only</option>
            <option value="connections">Connections</option>
          </select>

          {error && <div className="error">{error}</div>}

          <div className="modal-actions">
            <button 
              type="button" 
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading || !content.trim()}
            >
              {loading ? 'Posting...' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

### 3. Filters & Search

```typescript
import { useEffect, useState, useCallback } from 'react';
import { taskAPI } from '../api/taskAPI';

interface FilterState {
  status: string;
  priority: string;
  search: string;
}

export const TaskListWithFilters = () => {
  const [filters, setFilters] = useState<FilterState>({
    status: 'all',
    priority: 'all',
    search: '',
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      // Build query parameters
      const params: any = {};
      
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.priority !== 'all') params.priority = filters.priority;
      if (filters.search) params.search = filters.search;

      const data = await taskAPI.getTasks(params);
      setItems(data?.data || []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(loadItems, 300); // Debounce
    return () => clearTimeout(timer);
  }, [filters, loadItems]);

  return (
    <div>
      <div className="filters">
        <input
          type="text"
          placeholder="Search tasks..."
          value={filters.search}
          onChange={e => setFilters(prev => ({ 
            ...prev, 
            search: e.target.value 
          }))}
        />
        
        <select 
          value={filters.status}
          onChange={e => setFilters(prev => ({ 
            ...prev, 
            status: e.target.value 
          }))}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in-progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>

        <select 
          value={filters.priority}
          onChange={e => setFilters(prev => ({ 
            ...prev, 
            priority: e.target.value 
          }))}
        >
          <option value="all">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {loading && <div>Loading...</div>}
      
      {!loading && items.length === 0 && <div>No tasks found</div>}
      
      {!loading && items.length > 0 && (
        <div className="task-list">
          {items.map(item => (
            <div key={item._id} className="task-item">
              {item.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## Handling Errors & Loading States

### Standard Error Handling Pattern

```typescript
interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const initialState: AsyncState<any> = {
  data: null,
  loading: true,
  error: null,
};

export const useAsyncData = <T,>(
  fetchFn: () => Promise<T>,
  deps: any[] = []
) => {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setState({ data: null, loading: true, error: null });
      try {
        const result = await fetchFn();
        if (isMounted) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (err) {
        if (isMounted) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, deps);

  return state;
};

// Usage
export const MyComponent = () => {
  const { data, loading, error } = useAsyncData(
    () => taskAPI.getTasks(),
    []
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return <div>No data</div>;

  return <div>{/* render data */}</div>;
};
```

### User-Friendly Error Messages

```typescript
// Convert API errors to user-friendly messages
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    // API error with message
    if (error.message.includes('401')) return 'You must log in first';
    if (error.message.includes('403')) return 'You do not have permission';
    if (error.message.includes('404')) return 'Resource not found';
    if (error.message.includes('500')) return 'Server error. Please try again later';
    return error.message;
  }
  return 'An unexpected error occurred';
};

// Usage
try {
  await taskAPI.createTask(data);
} catch (error) {
  setError(getErrorMessage(error));
}
```

---

## Real-Time Updates with Socket.IO

### Subscribing to Events

```typescript
import { useEffect } from 'react';
import { useChat } from '../context/ChatContext';

export const RealTimeFeed = () => {
  const { socket } = useChat();
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    if (!socket) return;

    // Subscribe to new post event
    const handleNewPost = (post: any) => {
      setPosts(prev => [post, ...prev]);
    };

    socket.on('new_post', handleNewPost);

    // Cleanup
    return () => {
      socket.off('new_post', handleNewPost);
    };
  }, [socket]);

  return (
    <div>
      {posts.map(post => (
        <div key={post._id}>{post.content}</div>
      ))}
    </div>
  );
};
```

### Emitting Custom Events

```typescript
const handlePublishPost = async (postId: string) => {
  const result = await socialV2API.publishPost(postId, {
    targets: { linkedin: true }
  });

  if (socket) {
    // Notify other users about publication
    socket.emit('post_published', {
      postId,
      result,
      timestamp: new Date().toISOString(),
    });
  }
};
```

---

## Testing Your Implementation

### Manual Testing Checklist

- [ ] Load page in browser
- [ ] Check browser console for errors
- [ ] Test with different user roles
- [ ] Test error scenarios (network offline, API errors)
- [ ] Test loading states (spinner appears and disappears)
- [ ] Test form validation
- [ ] Test unauthorized access (redirect to login)
- [ ] Test real-time updates (open page in 2 browsers, make change in one, see update in other)

### Test Data Setup

```typescript
// Use dummy data for testing if backend not ready
const MOCK_POSTS = [
  {
    _id: '1',
    content: 'This is a test post',
    author: { _id: 'user1', name: 'John Doe' },
    createdAt: new Date().toISOString(),
    likes: [],
    comments: [],
  },
];

// Use with fallback
const useTestData = (apiCall: () => Promise<any>) => {
  const [data, setData] = useState(MOCK_POSTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    apiCall()
      .then(setData)
      .catch(err => {
        console.log('Using mock data due to:', err);
        // Keep mock data
      })
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
};
```

---

## Code Review Checklist

Before committing your code:

- [ ] All TypeScript types are defined
- [ ] Error handling is implemented
- [ ] Loading states are shown
- [ ] API calls use existing API wrapper functions
- [ ] No hardcoded URLs or API endpoints
- [ ] Component properly cleans up subscriptions (useEffect return)
- [ ] Proper routing added to App.tsx
- [ ] Navigation link added where applicable
- [ ] Form validation is present
- [ ] Proper role-based access control
- [ ] No console.log statements left (use only for debugging)
- [ ] Comments for complex logic
- [ ] Follows project naming conventions

---

## Common Pitfalls & Solutions

### Pitfall 1: Missing Dependency in useEffect

**❌ Wrong:**
```typescript
useEffect(() => {
  loadData();
  // loadData is missing from dependency array
}, []);
```

**✅ Correct:**
```typescript
useEffect(() => {
  loadData();
}, [loadData]); // Include in dependencies
```

### Pitfall 2: Not Checking Authentication

**❌ Wrong:**
```typescript
export const ProtectedPage = () => {
  // No auth check - anyone can see this
  return <div>Protected content</div>;
};
```

**✅ Correct:**
```typescript
export const ProtectedPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) navigate('/login');
  }, [isAuthenticated, navigate]);

  return <div>Protected content</div>;
};
```

### Pitfall 3: Race Conditions in Async Code

**❌ Wrong:**
```typescript
useEffect(() => {
  const loadData = async () => {
    const result1 = await fetchData();
    const result2 = await fetchMore(result1);
    setData(result2); // Might set stale data
  };
  loadData();
}, [query]); // Rapid changes cause multiple concurrent requests
```

**✅ Correct:**
```typescript
useEffect(() => {
  let isMounted = true;

  const loadData = async () => {
    const result1 = await fetchData();
    if (!isMounted) return; // Check if component unmounted
    
    const result2 = await fetchMore(result1);
    if (!isMounted) return;
    
    setData(result2);
  };

  loadData();

  return () => {
    isMounted = false;
  };
}, [query]);
```

---

## Next Steps

1. **Review the existing implementations:**
   - ✅ Tasks page for task management
   - ✅ SocialHub page for complex features
   - ✅ ChatPage for real-time updates

2. **Start with simpler features:**
   - List pages
   - Detail pages
   - Create/Edit forms

3. **Then move to complex features:**
   - Real-time features
   - Approval workflows
   - Multi-step forms

---

**Happy Coding!** 🚀

For questions or issues, refer to:
- Backend API docs: [Backend/FRONTEND_V2_PAGES_API.md](Backend/FRONTEND_V2_PAGES_API.md)
- System overview: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
- V2 Design: [Backend/README_V2_SYSTEM.md](Backend/README_V2_SYSTEM.md)
