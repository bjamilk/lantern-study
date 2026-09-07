import React from 'react';
import { classJoinPath } from '@lantern/shared/academic';

interface TeachJoinQrProps {
  code: string;
}

export const TeachJoinQr: React.FC<TeachJoinQrProps> = ({ code }) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}${classJoinPath(code)}`;
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  return (
    <figure className="flex flex-col items-center gap-2">
      <img src={src} alt={`QR code to join class ${code}`} width={220} height={220} className="rounded-lantern-lg bg-white p-2" />
      <figcaption className="text-caption text-lantern-text-secondary text-center">
        Students scan this in the hall, or open <span className="font-mono">{classJoinPath(code)}</span>
      </figcaption>
    </figure>
  );
};
