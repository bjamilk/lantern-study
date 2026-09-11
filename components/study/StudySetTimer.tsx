import React, { useEffect, useState } from 'react';
import { Button } from '../ui';

const DEFAULT_SECONDS = 25 * 60;

export const StudySetTimer: React.FC = () => {
  const [remaining, setRemaining] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <Button
      variant="secondary"
      onClick={() => {
        if (remaining === 0) setRemaining(DEFAULT_SECONDS);
        setRunning((value) => !value);
      }}
      aria-label={running ? 'Pause study timer' : 'Start 25 minute timer'}
    >
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </Button>
  );
};

export default StudySetTimer;
