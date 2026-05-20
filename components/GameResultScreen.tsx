import React from 'react';
import { GameSession, User } from '../types';
import { ArrowPathIcon, ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';

interface GameResultScreenProps {
  session: GameSession;
  currentUser: User;
  onRematch: (opponent: User) => void;
  onExit: () => void;
}

const GameResultScreen: React.FC<GameResultScreenProps> = ({ session, currentUser, onRematch, onExit }) => {
  const isWinner = session.winnerId === currentUser.id;
  const isDraw = !session.winnerId;

  const getResultText = () => {
    if (isDraw) return "It's a Draw!";
    if (isWinner) return "You Won!";
    return "You Lost!";
  };

  const getResultColor = () => {
    if (isDraw) return "text-yellow-500";
    if (isWinner) return "text-green-500";
    return "text-red-500";
  };
  
  const opponent = session.user.id === currentUser.id ? session.opponent : session.user;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-gray-100 text-gray-800 overflow-y-auto items-center justify-center">
        <div className="w-full max-w-2xl bg-white p-8 rounded-xl shadow-2xl text-center">
            <h1 className={`text-4xl md:text-5xl font-bold mb-4 ${getResultColor()}`}>{getResultText()}</h1>
            <p className="text-gray-600 mb-8">
                {isDraw ? "A hard-fought battle ends in a stalemate." : isWinner ? `Congratulations! You defeated ${opponent.name}.` : `A valiant effort, but ${opponent.name} was faster this time.`}
            </p>

            <div className="grid grid-cols-2 gap-4 text-left border-t border-b border-gray-200 py-6">
                {/* Your Results */}
                <div>
                    <div className="flex items-center mb-3">
                         <img src={currentUser.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=6366f1&color=fff&size=40`} alt={currentUser.name} className="w-10 h-10 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                         <h2 className="font-semibold text-lg text-gray-800">{currentUser.name} (You)</h2>
                    </div>
                    <div className="space-y-2 text-sm">
                        <p><span className="font-semibold">Score:</span> {session.userScore} / {session.questions.length}</p>
                        <p><span className="font-semibold">Total Time:</span> {session.userTime.toFixed(1)}s</p>
                    </div>
                </div>

                {/* Opponent's Results */}
                <div>
                     <div className="flex items-center mb-3">
                         <img src={opponent.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(opponent.name)}&background=ef4444&color=fff&size=40`} alt={opponent.name} className="w-10 h-10 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                         <h2 className="font-semibold text-lg text-gray-800">{opponent.name}</h2>
                    </div>
                     <div className="space-y-2 text-sm">
                        <p><span className="font-semibold">Score:</span> {session.opponentScore} / {session.questions.length}</p>
                        <p><span className="font-semibold">Total Time:</span> {session.opponentTime.toFixed(1)}s</p>
                    </div>
                </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-4">
                 <button
                    onClick={() => onRematch(opponent)}
                    className="w-full sm:w-auto px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-md flex items-center justify-center font-semibold text-lg"
                >
                    <ArrowPathIcon className="w-5 h-5 mr-2" />
                    Rematch
                </button>
                 <button
                    onClick={onExit}
                    className="w-full sm:w-auto px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-md flex items-center justify-center font-semibold text-lg"
                >
                    <ArrowLeftOnRectangleIcon className="w-5 h-5 mr-2" />
                    Exit
                </button>
            </div>
        </div>
    </div>
  );
};

export default GameResultScreen;