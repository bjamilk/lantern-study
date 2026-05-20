import React, { useEffect, useState } from 'react';

interface ConfettiPieceProps {
  id: number;
}

const ConfettiPiece: React.FC<ConfettiPieceProps> = ({ id }) => {
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const randomX = Math.random() * 100;
    const randomY = -10 - Math.random() * 20; // Start off-screen
    const randomSize = Math.random() * 8 + 6; // 6px to 14px
    const randomDuration = Math.random() * 3 + 4; // 4s to 7s
    const randomDelay = Math.random() * 3; // 0s to 3s
    const randomRotationStart = Math.random() * 360;
    const randomRotationEnd = randomRotationStart + (Math.random() * 720 - 360);

    setStyle({
      backgroundColor: randomColor,
      left: `${randomX}vw`,
      top: `${randomY}vh`,
      width: `${randomSize}px`,
      height: `${randomSize}px`,
      transform: `rotate(${randomRotationStart}deg)`,
      animation: `fall-${id} ${randomDuration}s linear ${randomDelay}s forwards`,
    });
    
    // Inject keyframes specific to this piece for unique rotation
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes fall-${id} {
        0% {
          transform: translateY(0vh) rotate(${randomRotationStart}deg);
          opacity: 1;
        }
        100% {
          transform: translateY(110vh) rotate(${randomRotationEnd}deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(styleSheet);
    
    // Cleanup on unmount
    return () => {
      document.head.removeChild(styleSheet);
    };

  }, [id]);

  return <div className="absolute rounded" style={style}></div>;
};

const Confetti: React.FC = () => {
  const confettiCount = 150;

  return (
    <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-[100] overflow-hidden">
      {[...Array(confettiCount)].map((_, i) => (
        <ConfettiPiece key={i} id={i} />
      ))}
    </div>
  );
};

export default Confetti;
