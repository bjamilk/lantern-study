import React, { useState, useRef, useEffect } from 'react';
import { PaperAirplaneIcon, PlusCircleIcon } from '@heroicons/react/24/solid';
import { featureAccents } from '@lantern/shared/design';

interface MessageInputBarProps {
  onSendMessage: (text: string) => void;
  onOpenQuestionModal?: () => void;
  onAIQuery?: (question: string) => Promise<string | null>;
  onTyping?: () => void;
}

const MessageInputBar: React.FC<MessageInputBarProps> = ({ onSendMessage, onOpenQuestionModal, onAIQuery, onTyping }) => {
  const [inputText, setInputText] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [inputText]);

  const handleSend = async () => {
    if (inputText.trim()) {
      const trimmed = inputText.trim();

      const aiMatch = trimmed.match(/^(?:@AI\s+|\/ask\s+)(.+)/is);
      if (aiMatch && onAIQuery) {
        const question = aiMatch[1].trim();
        setInputText('');
        setIsAIThinking(true);
        const answer = await onAIQuery(question);
        setIsAIThinking(false);
        if (answer) {
          onSendMessage(`🤖 AI Tutor:\n${answer}`);
        }
        return;
      }

      onSendMessage(trimmed);
      setInputText('');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 md:px-6 py-3 bg-lantern-surface border-t border-lantern-border">
      <div className="flex items-end gap-2">
        {onOpenQuestionModal && (
          <button
            type="button"
            onClick={onOpenQuestionModal}
            className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-primary hover:bg-lantern-primary-background rounded-lantern-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Submit a question"
            title="Submit Question"
          >
            <PlusCircleIcon className="w-6 h-6" />
          </button>
        )}
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              const now = Date.now();
              if (onTyping && now - lastTypingRef.current > 1500) {
                lastTypingRef.current = now;
                onTyping();
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={isAIThinking ? 'AI is thinking...' : 'Type a message... (prefix @AI or /ask for AI tutor)'}
            rows={1}
            disabled={isAIThinking}
            className="w-full resize-none px-4 py-2.5 border border-lantern-border rounded-2xl bg-lantern-background text-lantern-text text-sm placeholder:text-lantern-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary focus-visible:border-transparent transition-colors duration-200"
            style={{ maxHeight: '120px' }}
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!inputText.trim()}
          className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-background-secondary text-white disabled:text-lantern-text-tertiary rounded-lantern-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          <PaperAirplaneIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 ml-1">
        <p className="text-[11px] text-lantern-text-tertiary hidden sm:block">
          Press <kbd className="px-1 py-0.5 rounded bg-lantern-background-secondary text-lantern-text-secondary text-[10px] font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-lantern-background-secondary text-lantern-text-secondary text-[10px] font-mono">Shift+Enter</kbd> for new line
        </p>
        <p className="text-[10px] hidden sm:block" style={{ color: featureAccents.groups }}>
          Tip: prefix @AI or /ask for the AI tutor
        </p>
      </div>
    </div>
  );
};

export default MessageInputBar;
