import React, { useState } from 'react';
import { PlayIcon } from '@heroicons/react/24/solid';

interface YouTubeEmbedProps {
  videoId: string;
  title?: string;
}

/**
 * Lazy YouTube embed — iframe loads only after the user clicks play.
 * Avoids YouTube/doubleclick tracking requests (and console CORS noise) on page load.
 */
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = ({ videoId, title = 'YouTube video' }) => {
  const [playing, setPlaying] = useState(false);
  const safeVideoId = YOUTUBE_ID_PATTERN.test(videoId) ? videoId : null;

  if (!safeVideoId) {
    return (
      <div className="aspect-video w-full rounded-xl bg-lantern-background-secondary dark:bg-lantern-surface flex items-center justify-center text-sm text-lantern-text-secondary">
        Invalid YouTube video
      </div>
    );
  }

  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black text-left"
        aria-label={`Play ${title}`}
      >
        <img
          src={`https://img.youtube.com/vi/${safeVideoId}/hqdefault.jpg`}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 transition-colors group-hover:bg-black/45">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 shadow-lg group-hover:bg-red-500">
            <PlayIcon className="h-7 w-7 text-white translate-x-0.5" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="aspect-video overflow-hidden rounded-xl bg-black">
      <iframe
        title={title}
        className="h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${safeVideoId}?autoplay=1&rel=0&modestbranding=1`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
};

export default YouTubeEmbed;
