import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'lantern_cookie_notice_v1';

export function CookieNoticeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'dismissed');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed bottom-0 inset-x-0 z-[80] border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 py-3 shadow-lg"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 text-sm text-gray-700 dark:text-gray-200">
        <p className="flex-1">
          Lantern Study uses only essential cookies and local storage (sign-in session, theme, and UI preferences).
          We do not use analytics or advertising cookies.{' '}
          <Link to="/cookies" className="underline text-indigo-600 dark:text-indigo-400">
            Cookie Notice
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 text-sm font-medium"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default CookieNoticeBanner;
