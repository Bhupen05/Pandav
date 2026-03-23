/**
 * Error handling utilities for converting API errors to user-friendly messages
 */

export interface ApiError {
  message?: string;
  status?: number;
  code?: string;
  details?: unknown;
}

/**
 * Convert various error types to user-friendly messages
 */
export function getErrorMessage(error: unknown): string {
  // If error is a simple string
  if (typeof error === 'string') {
    return error;
  }

  // If error is an Error object
  if (error instanceof Error) {
    return error.message;
  }

  // If error has a message property
  if (error && typeof error === 'object' && 'message' in error) {
    const err = error as { message?: unknown };
    if (typeof err.message === 'string') {
      return err.message;
    }
  }

  // If error has a response (axios-style)
  if (error && typeof error === 'object' && 'response' in error) {
    const err = error as { response?: { data?: { message?: string; error?: string } } };
    if (err.response?.data?.message) {
      return err.response.data.message;
    }
    if (err.response?.data?.error) {
      return err.response.data.error;
    }
  }

  // Default message
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Get user-friendly error message based on error code or status
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const rawMessage = getErrorMessage(error);

  // Network errors
  if (rawMessage.includes('Network') || rawMessage.includes('ERR_NETWORK')) {
    return 'Network connection failed. Please check your internet connection.';
  }

  // Auth errors (401)
  if (
    rawMessage.includes('401') ||
    rawMessage.includes('Unauthorized') ||
    rawMessage.includes('Invalid token') ||
    rawMessage.includes('Token expired')
  ) {
    return 'Your session has expired. Please log in again.';
  }

  // Forbidden errors (403)
  if (rawMessage.includes('403') || rawMessage.includes('Forbidden')) {
    return 'You do not have permission to perform this action.';
  }

  // Not found errors (404)
  if (rawMessage.includes('404') || rawMessage.includes('not found')) {
    return 'The resource you requested could not be found.';
  }

  // Validation errors (400)
  if (
    rawMessage.includes('400') ||
    rawMessage.includes('Bad Request') ||
    rawMessage.includes('validation')
  ) {
    return 'Invalid input. Please check your data and try again.';
  }

  // Server errors (500+)
  if (rawMessage.includes('500') || rawMessage.includes('Server Error')) {
    return 'Server error. Please try again later or contact support.';
  }

  // Timeout
  if (rawMessage.includes('timeout') || rawMessage.includes('Timeout')) {
    return 'Request timed out. Please try again.';
  }

  return rawMessage;
}

/**
 * Error handler for async operations with retry logic
 */
export async function executeWithErrorHandling<T>(
  asyncFn: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    onError?: (error: Error) => void;
  } = {}
): Promise<T | null> {
  const { maxRetries = 1, retryDelay = 1000, onError } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;

      // If it's not the last attempt, retry after delay
      if (!isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      // On final failure, call error handler
      const errorMessage = getErrorMessage(error);
      const err = new Error(errorMessage);
      onError?.(err);

      return null;
    }
  }

  return null;
}

/**
 * Validation error message formatter
 */
export function formatValidationErrors(
  errors: Record<string, string | string[]> | null | undefined
): string {
  if (!errors || Object.keys(errors).length === 0) {
    return 'Validation failed. Please check your input.';
  }

  const messages = Object.entries(errors)
    .map(([field, messages]) => {
      const msgs = Array.isArray(messages) ? messages : [messages];
      return `${field}: ${msgs.join(', ')}`;
    })
    .slice(0, 3); // Show first 3 errors

  return messages.join('\n');
}

/**
 * Specific error messages for common API operations
 */
export const ErrorMessages = {
  // Auth errors
  INVALID_CREDENTIALS: 'Invalid email or password',
  USER_EXISTS: 'User already exists with this email',
  WEAK_PASSWORD: 'Password must be at least 8 characters',
  
  // Task errors
  TASK_NOT_FOUND: 'Task not found',
  TASK_COMPLETED: 'Cannot update a completed task',
  TASK_UPDATE_FAILED: 'Failed to update task',
  
  // Attendance errors
  ATTENDANCE_ALREADY_CHECKED_IN: 'You are already checked in',
  ATTENDANCE_NOT_CHECKED_IN: 'You are not checked in yet',
  
  // Team errors
  TEAM_NOT_FOUND: 'Team not found',
  ALREADY_IN_TEAM: 'You are already a member of this team',
  
  // Chat errors
  MESSAGE_SEND_FAILED: 'Failed to send message',
  INVALID_RECIPIENT: 'Invalid message recipient',
  
  // Social errors
  POST_NOT_FOUND: 'Post not found',
  POST_DELETE_FAILED: 'Failed to delete post',
  
  // General
  SOMETHING_WENT_WRONG: 'Something went wrong. Please try again.',
  OPERATION_TIMEOUT: 'Operation took too long. Please try again.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
} as const;
