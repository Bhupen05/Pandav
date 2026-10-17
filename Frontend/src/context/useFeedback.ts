import { createContext, useContext } from 'react';

export type NoticeTone = 'success' | 'error' | 'info';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  // Red confirm button, for destructive actions
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label: string;
  type?: 'text' | 'password';
  minLength?: number;
}

export interface FeedbackContextType {
  // Short message in the corner of the screen that goes away on its own
  notify: (message: string, tone?: NoticeTone) => void;
  // Resolves to true if the user confirms
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  // Resolves to the entered text, or null if cancelled
  prompt: (options: PromptOptions) => Promise<string | null>;
}

export const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used within FeedbackProvider');
  return context;
};
