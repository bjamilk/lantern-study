import React, { useState, useRef, useEffect } from 'react';
import { PaperAirplaneIcon, PlusCircleIcon } from '@heroicons/react/24/solid';

interface MessageInputBarProps {
  onSendMessage: (text: string) => void;
  onOpenQuestionModal?: () => void;
  onAIQuery?: (question: string) => Promise<string | null>;
}

const MessageInputBar: React.FC<MessageInputBarProps> = ({ onSendMessage, onOpenQuestionModal, onAIQuery }) => {
  const [inputText, setInputText] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
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

      // Detect @AI or /ask prefix
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
    <div className="px-4 md:px-6 py-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-end gap-2">
        {onOpenQuestionModal && (
          <button
            onClick={onOpenQuestionModal}
            className="flex-shrink-0 p-2 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAIThinking ? 'AI is thinking...' : 'Type a message... (prefix @AI or /ask for AI tutor)'}
            rows={1}
            disabled={isAIThinking}
            className="w-full resize-none px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-2xl bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:border-transparent transition-colors duration-150"
            style={{ maxHeight: '120px' }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!inputText.trim()}
          className="flex-shrink-0 p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 text-white disabled:text-slate-400 dark:disabled:text-slate-500 rounded-xl transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          <PaperAirplaneIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 ml-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:block">
          Press <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-mono">Shift+Enter</kbd> for new line
        </p>

      </div>
    </div>
  );
};

export default MessageInputBar;