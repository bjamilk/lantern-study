
import React from 'react';
import { StarIcon } from '@heroicons/react/24/solid';

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

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <div className={`flex items-center space-x-0.5 ${readOnly ? '' : 'cursor-pointer'}`}>
      {[...Array(starCount)].map((_, index) => {
        const starValue = index + 1;
        const isFilled = starValue <= rating;

        return (
          <button
            type="button"
            key={index}
            disabled={readOnly}
            onClick={() => onRatingChange && onRatingChange(starValue)}
            onMouseOver={() => !readOnly && onRatingChange && onRatingChange(starValue)}
            className={`transition-colors duration-150 focus:outline-none ${readOnly ? 'cursor-default' : ''}`}
            aria-label={`Rate ${starValue} star${starValue > 1 ? 's' : ''}`}
          >
            <StarIcon 
              className={`${sizeClasses[size]} ${isFilled ? 'text-yellow-500' : 'text-gray-300 dark:text-gray-600'}`} 
            />
          </button>
        );
      })}
    </div>
  );
};

export default StarRating;
