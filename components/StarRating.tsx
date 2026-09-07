
import React from 'react';
import { AppIcon } from './ui/AppIcon';

interface StarRatingProps {
  rating: number;
  onRatingChange?: (rating: number) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const StarRating: React.FC<StarRatingProps> = ({ 
  rating = 0, 
  onRatingChange, 
  readOnly = false,
  size = 'md' 
}) => {
  const starCount = 5;

  const sizeMap = {
    sm: 16,
    md: 20,
    lg: 24,
  };

  return (
    <div className="flex items-center space-x-0.5" role="group" aria-label={`Rating: ${rating} of ${starCount} stars`}>
      {[...Array(starCount)].map((_, index) => {
        const starValue = index + 1;
        const isFilled = starValue <= rating;

        return (
          <button
            type="button"
            key={index}
            disabled={readOnly}
            onClick={() => onRatingChange && onRatingChange(starValue)}
            onMouseEnter={() => !readOnly && onRatingChange && onRatingChange(starValue)}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
            aria-label={`Rate ${starValue} star${starValue > 1 ? 's' : ''}`}
            aria-pressed={isFilled}
          >
            <AppIcon
              name="star"
              size={sizeMap[size]}
              filled
              className={isFilled ? 'text-yellow-500' : 'text-lantern-text-tertiary dark:text-lantern-text-secondary'}
            />
          </button>
        );
      })}
    </div>
  );
};

export default StarRating;
