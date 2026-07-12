import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { XMarkIcon, TrashIcon, PaperAirplaneIcon, SparklesIcon, HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline';
import { HandThumbUpIcon as ThumbUpSolid, HandThumbDownIcon as ThumbDownSolid } from '@heroicons/react/24/solid';
import { useCompanionStore } from '../stores/companionStore';
import { useAuthStore } from '../stores/authStore';
import { CompanionMessage, CompanionAction, CompanionUserContext } from '../types';
import { submitCompanionFeedback, trackAIAnalyticsEvent } from '../services/ai';
import { AIDisclaimer } from './AIDisclaimer';
import Drawer from './ui/Drawer';

interface AICompanionPanelProps {
  context?: CompanionUserContext;
  onAction?: (action: CompanionAction) => void;
  theme?: 'light' | 'dark';
}

const QUICK_PROMPTS = [
  'What should I study today?',
  'Generate flashcards for my weak topics',
  'Quiz me on my weak topics',
  'Give me a study tip',
  'Explain spaced repetition',
  'Build my study plan for this week',
  'How am I spending this month?',
];

const AICompanionPanel: React.FC<AICompanionPanelProps> = ({ context, onAction, theme = 'light' }) => {
  const {
    isOpen, close, messages, isLoading, isLoadingHistory, historyLoaded, isStreaming, error,
    loadHistory, sendMessageStreaming, clearHistory, clearError,
    pendingMessage, setPendingMessage,
  } = useCompanionStore();
  const currentUser = useAuthStore(s => s.currentUser);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Load history on first open
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (isOpen && !hasLoaded.current && currentUser) {
      hasLoaded.current = true;
      loadHistory();
    }
  }, [isOpen, currentUser, loadHistory]);

  // Auto-send pending message only after history has loaded (never during history fetch)
  useEffect(() => {
    if (
      isOpen &&
      pendingMessage &&
      historyLoaded &&
      !isLoadingHistory &&
      !isLoading &&
      !isStreaming
    ) {
      const msg = pendingMessage;
      setPendingMessage(null);
      setInput('');
      handleSend(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingMessage, historyLoaded, isLoadingHistory, isLoading, isStreaming]);

  // Scroll to bottom on new messages / streaming tokens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isStreaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const enrichedContext: CompanionUserContext = useMemo(() => ({
    userName: currentUser?.firstName || currentUser?.name || 'Student',
    ...context,
  }), [currentUser?.firstName, currentUser?.name, context]);

  const isBusy = isLoading || isStreaming || isLoadingHistory;

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isBusy) return;
    setInput('');
    await sendMessageStreaming(msg, enrichedContext);
    trackAIAnalyticsEvent('companion_message_sent', { screen: context?.currentScreen });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isBusy, sendMessageStreaming, enrichedContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = async () => {
    setShowClearConfirm(false);
    await clearHistory();
  };

  const handleAction = (action: CompanionAction) => {
    onAction?.(action);
    trackAIAnalyticsEvent('companion_action_clicked', { action_type: action.type, label: action.label });
    close();
  };

  if (!isOpen) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      ariaLabelledBy="ai-companion-title"
      maxWidthClass="max-w-sm"
      zIndexClass="z-50"
      backdropClassName="bg-black/20 md:hidden"
      panelClassName={`!p-0 shadow-2xl ${theme === 'dark' ? 'bg-lantern-background text-white' : 'bg-lantern-surface text-lantern-text'}`}
      loading={isBusy}
      closeOnBackdrop={!isBusy}
    >

        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b flex-shrink-0
          ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-primary-background'}`}>
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-lantern-primary flex-shrink-0">
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="ai-companion-title" className="font-semibold text-sm text-lantern-primary">Lantern</p>
            <p className={`text-xs truncate ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              {context?.currentScreen ? `On: ${context.currentScreen}` : 'Your AI study companion'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowClearConfirm(true)}
              title="Clear conversation"
              className={`p-1.5 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
            <button
              onClick={close}
              title="Close"
              aria-label="Close AI companion"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-lantern-surface-secondary text-lantern-text-tertiary' : 'hover:bg-lantern-background-secondary text-lantern-text-secondary'}`}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clear confirm banner */}
        {showClearConfirm && (
          <div className={`px-4 py-2 flex items-center gap-2 text-sm border-b flex-shrink-0
            ${theme === 'dark' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="flex-1">Clear entire conversation?</span>
            <button onClick={handleClear} className="font-medium hover:underline">Yes</button>
            <button onClick={() => setShowClearConfirm(false)} className="font-medium hover:underline">Cancel</button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className={`px-4 py-2 flex items-center gap-2 text-sm border-b flex-shrink-0
            ${theme === 'dark' ? 'bg-red-900/30 border-red-700 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="font-medium hover:underline">Dismiss</button>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {isLoadingHistory && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-lantern-text-secondary">
              <TypingDots />
              <span>Loading conversation…</span>
            </div>
          )}

          {!isLoadingHistory && messages.length === 0 && !isBusy && (
            <EmptyState theme={theme} onQuickPrompt={handleSend} />
          )}

          {!isLoadingHistory && messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              theme={theme}
              onAction={handleAction}
              isStreaming={isStreaming && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id}
            />
          ))}

          {/* Typing indicator (non-streaming fallback) */}
          {isLoading && !isStreaming && (
            <div className="flex items-start gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-lantern-primary flex-shrink-0 mt-0.5">
                <SparklesIcon className="w-4 h-4 text-white" />
              </div>
              <div className={`px-3 py-2 rounded-2xl rounded-tl-none max-w-[80%]
                ${theme === 'dark' ? 'bg-lantern-surface-secondary' : 'bg-lantern-background-secondary'}`}>
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className={`px-4 py-3 border-t flex-shrink-0
          ${theme === 'dark' ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-background'}`}>
          <div className={`flex items-end gap-2 rounded-xl border px-3 py-2
            ${theme === 'dark' ? 'bg-lantern-surface-secondary border-lantern-border' : 'bg-lantern-surface border-lantern-border'}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Lantern anything…"
              rows={1}
              className={`flex-1 resize-none bg-transparent text-sm outline-none max-h-24 leading-relaxed
                placeholder:text-lantern-text-tertiary ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 96) + 'px';
              }}
              disabled={isBusy}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isBusy}
              className="flex-shrink-0 p-1.5 rounded-lg bg-lantern-primary text-white disabled:opacity-40 hover:bg-lantern-primary-dark transition-colors"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
          <div className={`mt-1.5 text-center ${theme === 'dark' ? 'text-lantern-text-secondary' : 'text-lantern-text-tertiary'}`}>
            <AIDisclaimer compact />
          </div>
        </div>
    </Drawer>
  );
};

// ─── Sub-components ────────────────────────────────────────

interface MessageBubbleProps {
  message: CompanionMessage;
  theme: 'light' | 'dark';
  onAction: (action: CompanionAction) => void;
  isStreaming?: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, theme, onAction, isStreaming }) => {
  const isUser = message.role === 'user';
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (feedback) return; // already rated
    setFeedback(rating);
    await submitCompanionFeedback(message.id, rating);
    trackAIAnalyticsEvent('companion_feedback', { rating, messageId: message.id });
  };

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-lantern-primary flex-shrink-0 mt-0.5">
          <SparklesIcon className="w-4 h-4 text-white" />
        </div>
      )}
      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-lantern-primary text-white rounded-tr-none'
            : theme === 'dark'
              ? 'bg-lantern-surface-secondary text-white rounded-tl-none'
              : 'bg-lantern-background-secondary text-lantern-text rounded-tl-none'
          }`}>
          {message.content}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-current animate-pulse align-middle" />
          )}
        </div>
        {/* Action buttons */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {message.actions.map((action, i) => (
              <button
                key={i}
                onClick={() => onAction(action)}
                className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors
                  ${theme === 'dark'
                    ? 'border-lantern-primary text-lantern-primary-light hover:bg-lantern-primary-dark'
                    : 'border-lantern-primary text-lantern-primary hover:bg-lantern-primary-background'
                  }`}
              >
                → {action.label}
              </button>
            ))}
          </div>
        )}
        {/* Thumbs feedback (only on completed assistant messages) */}
        {!isUser && !isStreaming && message.content.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <button
              onClick={() => handleFeedback('up')}
              title="Good response"
              disabled={!!feedback}
              className={`p-1 rounded transition-colors disabled:cursor-default
                ${feedback === 'up'
                  ? 'text-green-500'
                  : theme === 'dark' ? 'text-lantern-text-secondary hover:text-green-400' : 'text-lantern-text-tertiary hover:text-green-500'
                }`}
            >
              {feedback === 'up' ? <ThumbUpSolid className="w-3.5 h-3.5" /> : <HandThumbUpIcon className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => handleFeedback('down')}
              title="Poor response"
              disabled={!!feedback}
              className={`p-1 rounded transition-colors disabled:cursor-default
                ${feedback === 'down'
                  ? 'text-red-500'
                  : theme === 'dark' ? 'text-lantern-text-secondary hover:text-red-400' : 'text-lantern-text-tertiary hover:text-red-500'
                }`}
            >
              {feedback === 'down' ? <ThumbDownSolid className="w-3.5 h-3.5" /> : <HandThumbDownIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ theme: 'light' | 'dark'; onQuickPrompt: (text: string) => void }> = ({ theme, onQuickPrompt }) => (
  <div className="flex flex-col items-center gap-4 py-6 text-center">
    <div className="flex items-center justify-center w-14 h-14 rounded-full bg-lantern-primary-background dark:bg-lantern-primary-dark">
      <SparklesIcon className="w-8 h-8 text-lantern-primary" />
    </div>
    <div>
      <p className={`font-semibold text-base ${theme === 'dark' ? 'text-white' : 'text-lantern-text'}`}>Hi, I'm Lantern!</p>
      <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
        Your personal AI study companion. Ask me anything.
      </p>
    </div>
    <div className="flex flex-wrap justify-center gap-2 mt-1">
      {QUICK_PROMPTS.map(p => (
        <button
          key={p}
          onClick={() => onQuickPrompt(p)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors
            ${theme === 'dark'
              ? 'border-lantern-border text-lantern-text-tertiary hover:bg-lantern-surface-secondary'
              : 'border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary'
            }`}
        >
          {p}
        </button>
      ))}
    </div>
  </div>
);

const TypingDots: React.FC = () => (
  <div className="flex items-center gap-1 h-5">
    {[0, 1, 2].map(i => (
      <span
        key={i}
        className="w-2 h-2 rounded-full bg-lantern-border animate-bounce"
        style={{ animationDelay: `${i * 150}ms`, animationDuration: '800ms' }}
      />
    ))}
  </div>
);

export default AICompanionPanel;

