import React, { useEffect, useRef } from 'react';
import { GameSession, User } from '../types';
import { ArrowPathIcon, ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { gameAudio } from '../utils/audio';

interface GameResultScreenProps {
  session: GameSession;
  currentUser: User;
  onRematch: (opponent: User) => void;
  onExit: () => void;
}

interface ConfettiParticle {
  x: number;
  y: number;
  r: number;
  d: number;
  color: string;
  tilt: number;
  tiltAngleIncremental: number;
  tiltAngle: number;
}

const GameResultScreen: React.FC<GameResultScreenProps> = ({ session, currentUser, onRematch, onExit }) => {
  const isWinner = session.winnerId === currentUser.id;
  const isDraw = !session.winnerId;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const opponent = session.user.id === currentUser.id ? session.opponent : session.user;

  // Sound and Confetti trigger
  useEffect(() => {
    // Play correct win/loss fanfare melody
    gameAudio.playFanfare(isWinner && !isDraw);

    if (!isWinner || isDraw) return;

    // Canvas Confetti
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const colors = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#ff7849'];
    const particles: ConfettiParticle[] = Array.from({ length: 120 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height - height,
      r: Math.random() * 6 + 4,
      d: Math.random() * height,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    }));

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p, idx) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
        p.x += Math.sin(p.tiltAngle);
        p.tilt = Math.sin(p.tiltAngle - idx / 3) * 15;

        if (p.y > height) {
          p.x = Math.random() * width;
          p.y = -20;
          p.tilt = Math.random() * 10 - 5;
        }

        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
        ctx.stroke();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isWinner, isDraw]);

  const getResultText = () => {
    if (session.isSoloPractice) return 'Practice Complete!';
    if (session.awaitingOpponent) return 'Answers Submitted';
    if (isDraw) return "It's a Draw!";
    if (isWinner) return "Victory!";
    return "Defeat!";
  };

  const getResultColor = () => {
    if (isDraw) return "text-amber-500 dark:text-amber-400";
    if (isWinner) return "text-emerald-500 dark:text-emerald-400";
    return "text-rose-500 dark:text-rose-400";
  };

  const getResultSubtitle = () => {
    if (session.isSoloPractice) return 'Solo practice — no win recorded.';
    if (session.awaitingOpponent) return `Waiting for ${opponent.name} to finish. You'll be notified when results are ready.`;
    if (isDraw) return "A legendary duel ends in a perfect tie!";
    if (isWinner) return `Outstanding! You defeated ${opponent.name}.`;
    return `A valiant effort! Next time you'll be faster.`;
  };

  return (
    <div className="relative flex-1 flex flex-col p-4 md:p-6 bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 overflow-y-auto items-center justify-center min-h-screen">
      {/* Background Confetti Canvas */}
      {isWinner && !isDraw && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />
      )}

      <div className="w-full max-w-2xl bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 text-center z-10">
        
        {/* Animated Headline */}
        <h1 className={`text-4xl md:text-5xl font-extrabold tracking-tight mb-2 ${getResultColor()}`}>
          {getResultText()}
        </h1>
        <p className="text-slate-600 dark:text-slate-450 text-md md:text-lg mb-8 font-medium">
          {getResultSubtitle()}
        </p>

        {/* Kahoot Victory Podium */}
        <div className="flex justify-center items-end space-x-6 mb-8 mt-4 pt-10 h-72">
          {isDraw ? (
            // Draw Podium (Equal Pedestals)
            <>
              {/* User Pedestal */}
              <div className="flex flex-col items-center w-28">
                <div className="relative mb-2">
                  <div className="w-14 h-14 rounded-full border-4 border-indigo-400 overflow-hidden bg-slate-100 flex items-center justify-center">
                    <img 
                      src={currentUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=6366f1&color=fff&size=56`} 
                      alt={currentUser.name} 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                    />
                  </div>
                </div>
                <div className="bg-gradient-to-t from-indigo-500 to-indigo-400 w-full h-36 rounded-t-xl flex flex-col justify-between p-3 text-white shadow-md">
                  <span className="font-extrabold text-2xl">1</span>
                  <div className="flex flex-col">
                    <span className="text-xs truncate font-bold">{currentUser.name}</span>
                    <span className="text-[10px] font-medium">{session.userScore} pts</span>
                  </div>
                </div>
              </div>

              {/* Opponent Pedestal */}
              <div className="flex flex-col items-center w-28">
                <div className="relative mb-2">
                  <div className="w-14 h-14 rounded-full border-4 border-indigo-400 overflow-hidden bg-slate-100 flex items-center justify-center">
                    <img 
                      src={opponent.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(opponent.name)}&background=ef4444&color=fff&size=56`} 
                      alt={opponent.name} 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                    />
                  </div>
                </div>
                <div className="bg-gradient-to-t from-indigo-500 to-indigo-400 w-full h-36 rounded-t-xl flex flex-col justify-between p-3 text-white shadow-md">
                  <span className="font-extrabold text-2xl">1</span>
                  <div className="flex flex-col">
                    <span className="text-xs truncate font-bold">{opponent.name}</span>
                    <span className="text-[10px] font-medium">{session.opponentScore} pts</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Winner vs Loser Podium
            <>
              {/* 2nd Place (Loser) Pedestal */}
              <div className="flex flex-col items-center w-26">
                <div className="relative mb-2">
                  <div className="w-12 h-12 rounded-full border-4 border-slate-300 overflow-hidden bg-slate-100 flex items-center justify-center">
                    <img 
                      src={(!isWinner ? currentUser : opponent).avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent((!isWinner ? currentUser : opponent).name)}&background=cbd5e1&color=334155&size=48`} 
                      alt={(!isWinner ? currentUser : opponent).name} 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                    />
                  </div>
                </div>
                <div className="bg-gradient-to-t from-slate-400 to-slate-300 w-full h-32 rounded-t-xl flex flex-col justify-between p-3 text-slate-800 shadow-md">
                  <span className="font-extrabold text-xl">2</span>
                  <div className="flex flex-col">
                    <span className="text-xs truncate font-bold">{(!isWinner ? currentUser : opponent).name}</span>
                    <span className="text-[10px] font-medium">{!isWinner ? session.userScore : session.opponentScore} pts</span>
                  </div>
                </div>
              </div>

              {/* 1st Place (Winner) Pedestal */}
              <div className="flex flex-col items-center w-28">
                <div className="relative mb-2">
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-2xl animate-bounce">👑</span>
                  <div className="w-16 h-16 rounded-full border-4 border-amber-400 overflow-hidden bg-slate-105 flex items-center justify-center ring-4 ring-amber-350 animate-pulse">
                    <img 
                      src={(isWinner ? currentUser : opponent).avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent((isWinner ? currentUser : opponent).name)}&background=f59e0b&color=fff&size=64`} 
                      alt={(isWinner ? currentUser : opponent).name} 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                    />
                  </div>
                </div>
                <div className="bg-gradient-to-t from-amber-500 to-yellow-400 w-full h-44 rounded-t-xl flex flex-col justify-between p-3 text-amber-950 shadow-md">
                  <span className="font-extrabold text-3xl">1</span>
                  <div className="flex flex-col">
                    <span className="text-sm truncate font-black">{(isWinner ? currentUser : opponent).name}</span>
                    <span className="text-xs font-bold">{(isWinner ? session.userScore : session.opponentScore)} pts</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Detailed Game Stats Grid */}
        <div className="grid grid-cols-2 gap-6 border-t border-b border-slate-200 dark:border-slate-700 py-6 mb-8 text-left text-sm font-medium">
          {/* Your Stats */}
          <div className="space-y-3">
            <h3 className="font-bold text-md text-blue-600 dark:text-blue-400 flex items-center">
              <span>{currentUser.name} (You)</span>
            </h3>
            <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
              <li><span className="font-bold">Correct Answers:</span> {session.userCorrectAnswers || 0} / {session.questions.length}</li>
              <li><span className="font-bold">Total Points:</span> {session.userScore} pts</li>
              <li><span className="font-bold">Total Time:</span> {session.userTime.toFixed(1)}s</li>
              <li><span className="font-bold">Max Streak:</span> 🔥 {session.userStreakMax || 0}</li>
            </ul>
          </div>

          {/* Opponent Stats */}
          <div className="space-y-3">
            <h3 className="font-bold text-md text-slate-700 dark:text-slate-300">
              <span>{opponent.name}</span>
            </h3>
            <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
              <li><span className="font-bold">Correct Answers:</span> {session.opponentCorrectAnswers || 0} / {session.questions.length}</li>
              <li><span className="font-bold">Total Points:</span> {session.opponentScore} pts</li>
              <li><span className="font-bold">Total Time:</span> {session.opponentTime.toFixed(1)}s</li>
              <li><span className="font-bold">Max Streak:</span> 🔥 {session.opponentStreakMax || 0}</li>
            </ul>
          </div>
        </div>

        {/* Game Screen Controls */}
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
          <button
            onClick={() => onRematch(opponent)}
            className="w-full sm:w-auto px-6 py-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-150"
          >
            <ArrowPathIcon className="w-5 h-5 mr-2" />
            Rematch
          </button>
          <button
            onClick={onExit}
            className="w-full sm:w-auto px-6 py-3.5 bg-slate-500 hover:bg-slate-600 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-150"
          >
            <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-2" />
            Exit Game
          </button>
        </div>

      </div>
    </div>
  );
};

export default GameResultScreen;