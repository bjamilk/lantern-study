import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Flashcard, FlashcardType, Deck } from '../types';
import { uploadFlashcardImage } from '../services/supabase';
import { XCircleIcon, PlusCircleIcon, InformationCircleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import AIUsageInline from './AIUsageInline';
import Modal from './ui/Modal';
import {
  formatFreeformPointsForSvg,
  getBlurRegions,
  getFreeformPaths,
  normalizeOcclusionData,
} from '@lantern/shared/utils';

interface CreateFlashcardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Omit<Flashcard, 'createdAt'>> & { id?: string }) => void;
  decks: Deck[];
  initialDeckId?: string;
  editingFlashcard?: Flashcard | null;
  onEnhanceFlashcard?: (front: string, back: string) => Promise<{ front: string; back: string; mnemonic?: string; example?: string } | null>;
}

// Custom templates, template categories, and LaTeX helper logic have been removed.

type OcclusionType = 'rectangles' | 'circles' | 'freeform' | 'blur';

type Point = { x: number; y: number };

type PendingOcclusionShape =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'circle'; x: number; y: number; radius: number }
  | { type: 'freeform'; points: Point[] }
  | { type: 'blur'; x: number; y: number; width: number; height: number; radius: number; opacity: number };

const FreeformMaskSvg: React.FC<{
  paths: { points: Point[] }[];
  className?: string;
  activeIndex?: number | null;
}> = ({ paths, className = '', activeIndex = null }) => (
  <svg
    className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
    viewBox="0 0 1 1"
    preserveAspectRatio="none"
  >
    {paths.map((path, idx) => (
      <polygon
        key={idx}
        points={formatFreeformPointsForSvg(path.points)}
        fill={activeIndex === idx ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.7)'}
        stroke={activeIndex === idx ? 'rgba(147,197,253,1)' : 'rgba(255,255,255,0.7)'}
        strokeWidth={0.004}
      />
    ))}
  </svg>
);

const CreateFlashcardModal: React.FC<CreateFlashcardModalProps> = ({ isOpen, onClose, onSubmit, decks, initialDeckId, editingFlashcard, onEnhanceFlashcard }) => {
  const [deckId, setDeckId] = useState<string>(initialDeckId || decks[0]?.id || '');
  const [type, setType] = useState<FlashcardType>(FlashcardType.BASIC);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [clozeText, setClozeText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [occlusionType, setOcclusionType] = useState<OcclusionType>('rectangles');
  const [occlusionData, setOcclusionData] = useState<Flashcard['occlusionData']>({ type: 'rectangles', rectangles: [] });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(0.025);
  const [blurRadius, setBlurRadius] = useState(0.15);
  const [blurOpacity, setBlurOpacity] = useState(0.4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingShape, setDrawingShape] = useState<PendingOcclusionShape | null>(null);
  const [activeShapeIndex, setActiveShapeIndex] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement | null>(null);
  const backRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  
  const isEditing = !!editingFlashcard;

  useEffect(() => {
    if (isOpen) {
        if(isEditing && editingFlashcard) {
            setDeckId(editingFlashcard.deckId);
            setType(editingFlashcard.type);
            setFront(editingFlashcard.front || '');
            setBack(editingFlashcard.back || '');
            setClozeText(editingFlashcard.clozeText || '');
            setImageUrl(editingFlashcard.imageUrl || '');
            const existingOcclusion = normalizeOcclusionData(editingFlashcard.occlusionData);
            setOcclusionType(existingOcclusion?.type ?? 'rectangles');
            setOcclusionData(existingOcclusion ?? getEmptyOcclusionData('rectangles'));
        } else {
            setDeckId(initialDeckId || decks[0]?.id || '');
            setType(FlashcardType.BASIC);
            setFront('');
            setBack('');
            setClozeText('');
            setImageUrl('');
        }
    }
  }, [isOpen, decks, initialDeckId, editingFlashcard, isEditing]);


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;
      const active = document.activeElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable);

      if (event.key === 'Escape') {
        if (isDrawing) {
          setIsDrawing(false);
          setDrawingShape(null);
        }
        setActiveShapeIndex(null);
        setDragMode(null);
        return;
      }

      if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (activeShapeIndex !== null) {
          removeOcclusionShape(activeShapeIndex);
          setActiveShapeIndex(null);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isDrawing, activeShapeIndex]);


  const handleUploadImage = async (file: File) => {
    setIsUploadingImage(true);
    try {
      const result = await uploadFlashcardImage(file);
      setImageUrl(result.url);
      useToastStore.getState().showToast('Image uploaded successfully! URL inserted.', 'success');
    } catch (error: any) {
      console.error('Failed to upload image:', error);
      useToastStore.getState().showToast('Failed to upload image. Please try again.', 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const clampPercent = (value: number) => Math.max(0, Math.min(1, value));

  const snapValue = (value: number) => {
    const clamped = clampPercent(value);
    if (!snapToGrid) return clamped;
    return clampPercent(Math.round(clamped / gridSize) * gridSize);
  };

  const getEmptyOcclusionData = (type: OcclusionType): Flashcard['occlusionData'] => {
    switch (type) {
      case 'circles':
        return { type, circles: [] };
      case 'freeform':
        return { type, freeforms: [] };
      case 'blur':
        return { type, blur: [] };
      case 'rectangles':
      default:
        return { type, rectangles: [] };
    }
  };

  const normalizeCoord = (raw: number) =>
    occlusionType === 'freeform' ? clampPercent(raw) : snapValue(raw);

  useEffect(() => {
    setOcclusionData(prev => {
      if (prev && prev.type === occlusionType) return prev;
      return getEmptyOcclusionData(occlusionType);
    });
    setActiveShapeIndex(null);
    setDrawingShape(null);
    setIsDrawing(false);
    setDragMode(null);
  }, [occlusionType]);

  const clearOcclusions = () => {
    setOcclusionData(getEmptyOcclusionData(occlusionType));
  };

  const addOcclusionShape = (shape: PendingOcclusionShape) => {
    setOcclusionData(prev => {
      const base = prev || getEmptyOcclusionData(occlusionType);
      switch (shape.type) {
        case 'rect':
          return { type: 'rectangles', rectangles: [...(base.rectangles || []), { x: shape.x, y: shape.y, width: shape.width, height: shape.height }] };
        case 'circle':
          return { type: 'circles', circles: [...(base.circles || []), { x: shape.x, y: shape.y, radius: shape.radius }] };
        case 'freeform':
          return {
            type: 'freeform',
            freeforms: [...getFreeformPaths(base), { points: shape.points }],
          };
        case 'blur':
          return { type: 'blur', blur: [...(base.blur || []), { x: shape.x, y: shape.y, width: shape.width, height: shape.height, radius: shape.radius, opacity: shape.opacity }] };
        default:
          return base;
      }
    });
  };

  const updateOcclusionShape = (index: number, updater: (shape: any) => any) => {
    setOcclusionData(prev => {
      if (!prev) return prev;
      if (prev.type === 'rectangles' && prev.rectangles) {
        const next = [...prev.rectangles];
        next[index] = updater(next[index]);
        return { ...prev, rectangles: next };
      }
      if (prev.type === 'circles' && prev.circles) {
        const next = [...prev.circles];
        next[index] = updater(next[index]);
        return { ...prev, circles: next };
      }
      if (prev.type === 'blur' && prev.blur) {
        const next = [...prev.blur];
        next[index] = updater(next[index]);
        return { ...prev, blur: next };
      }
      return prev;
    });
  };

  const removeOcclusionShape = (index: number) => {
    setOcclusionData(prev => {
      if (!prev) return prev;
      if (prev.type === 'rectangles' && prev.rectangles) {
        const next = prev.rectangles.filter((_, i) => i !== index);
        return { ...prev, rectangles: next };
      }
      if (prev.type === 'circles' && prev.circles) {
        const next = prev.circles.filter((_, i) => i !== index);
        return { ...prev, circles: next };
      }
      if (prev.type === 'freeform') {
        const next = getFreeformPaths(prev).filter((_, i) => i !== index);
        return { ...prev, freeforms: next };
      }
      if (prev.type === 'blur' && prev.blur) {
        const next = prev.blur.filter((_, i) => i !== index);
        return { ...prev, blur: next };
      }
      return prev;
    });
  };

  const determineDragMode = (shape: any, x: number, y: number) => {
    const edgeThreshold = 0.06;
    if (occlusionType === 'rectangles' && shape) {
      const nearRight = Math.abs(x - (shape.x + shape.width)) < edgeThreshold;
      const nearBottom = Math.abs(y - (shape.y + shape.height)) < edgeThreshold;
      if (nearRight || nearBottom) return 'resize';
    }
    if ((occlusionType === 'blur' || occlusionType === 'circles') && shape) {
      if (occlusionType === 'circles') {
        const dist = Math.hypot(x - shape.x, y - shape.y);
        const nearCircle = Math.abs(dist - shape.radius) < edgeThreshold;
        if (nearCircle) return 'resize';
      } else {
        const nearRight = Math.abs(x - (shape.x + shape.width)) < edgeThreshold;
        const nearBottom = Math.abs(y - (shape.y + shape.height)) < edgeThreshold;
        if (nearRight || nearBottom) return 'resize';
      }
    }
    return 'move';
  };

  const handleShapeMouseDown = (index: number, event: React.MouseEvent<HTMLDivElement, MouseEvent>, shape: any) => {
    event.stopPropagation();
    if (type !== FlashcardType.IMAGE_OCCLUSION) return;
    const container = imageContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = snapValue((event.clientX - rect.left) / rect.width);
    const startY = snapValue((event.clientY - rect.top) / rect.height);

    setActiveShapeIndex(index);
    setDragStart({ x: startX, y: startY });
    setDragMode(determineDragMode(shape, startX, startY));
  };

  const handleStartDrawing = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (type !== FlashcardType.IMAGE_OCCLUSION) return;
    const container = imageContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = normalizeCoord((event.clientX - rect.left) / rect.width);
    const startY = normalizeCoord((event.clientY - rect.top) / rect.height);

    setIsDrawing(true);
    setActiveShapeIndex(null);
    setDragMode(null);

    if (occlusionType === 'freeform') {
      setDrawingShape({ type: 'freeform', points: [{ x: startX, y: startY }] });
    } else if (occlusionType === 'circles') {
      setDrawingShape({ type: 'circle', x: startX, y: startY, radius: 0 });
    } else if (occlusionType === 'blur') {
      setDrawingShape({ type: 'blur', x: startX, y: startY, width: 0, height: 0, radius: blurRadius, opacity: blurOpacity });
    } else {
      setDrawingShape({ type: 'rect', x: startX, y: startY, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const container = imageContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rawX = (event.clientX - rect.left) / rect.width;
    const rawY = (event.clientY - rect.top) / rect.height;

    const currentX = normalizeCoord(rawX);
    const currentY = normalizeCoord(rawY);

    if (isDrawing && drawingShape) {
      if (drawingShape.type === 'freeform') {
        setDrawingShape(prev => {
          if (!prev || prev.type !== 'freeform') return prev;
          const last = prev.points[prev.points.length - 1];
          if (last && Math.hypot(currentX - last.x, currentY - last.y) < 0.008) return prev;
          return { ...prev, points: [...prev.points, { x: currentX, y: currentY }] };
        });
      } else if (drawingShape.type === 'circle') {
        const radius = snapValue(Math.max(0, Math.hypot(currentX - drawingShape.x, currentY - drawingShape.y)));
        setDrawingShape({ ...drawingShape, radius });
      } else {
        const x = snapValue(Math.min(drawingShape.x, currentX));
        const y = snapValue(Math.min(drawingShape.y, currentY));
        const width = snapValue(Math.abs(currentX - drawingShape.x));
        const height = snapValue(Math.abs(currentY - drawingShape.y));
        setDrawingShape({ ...drawingShape, x, y, width, height });
      }
      return;
    }

    if (activeShapeIndex !== null && dragStart && dragMode) {
      const dx = currentX - dragStart.x;
      const dy = currentY - dragStart.y;
      setDragStart({ x: currentX, y: currentY });

      if (occlusionData?.type === 'rectangles' && occlusionData.rectangles) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          return {
            ...shape,
            width: snapValue(Math.max(0, shape.width + dx)),
            height: snapValue(Math.max(0, shape.height + dy)),
          };
        });
      } else if (occlusionData?.type === 'circles' && occlusionData.circles) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          const radius = snapValue(Math.max(0, shape.radius + (dx + dy) / 2));
          return { ...shape, radius };
        });
      } else if (occlusionData?.type === 'blur' && occlusionData.blur) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          return {
            ...shape,
            width: snapValue(Math.max(0, shape.width + dx)),
            height: snapValue(Math.max(0, shape.height + dy)),
          };
        });
      }
    }
  };

  const handleFinishDrawing = () => {
    if (isDrawing && drawingShape) {
      if (drawingShape.type === 'rect' && drawingShape.width > 0.01 && drawingShape.height > 0.01) {
        addOcclusionShape(drawingShape);
      }
      if (drawingShape.type === 'circle' && drawingShape.radius > 0.02) {
        addOcclusionShape(drawingShape);
      }
      if (drawingShape.type === 'freeform' && drawingShape.points.length > 2) {
        const points = [...drawingShape.points];
        const first = points[0];
        const last = points[points.length - 1];
        if (first && last && Math.hypot(first.x - last.x, first.y - last.y) > 0.02) {
          points.push(first);
        }
        addOcclusionShape({ type: 'freeform', points });
      }
      if (drawingShape.type === 'blur' && drawingShape.width > 0.01 && drawingShape.height > 0.01) {
        addOcclusionShape(drawingShape);
      }
    }

    setIsDrawing(false);
    setDrawingShape(null);
    setDragMode(null);
    setActiveShapeIndex(null);
    setDragStart(null);
  };

  // Commit drawing when mouse is released anywhere on the page (not just inside the container)
  useEffect(() => {
    const onGlobalUp = () => {
      if (isDrawing || dragMode) {
        handleFinishDrawing();
      }
    };
    window.addEventListener('mouseup', onGlobalUp);
    window.addEventListener('touchend', onGlobalUp);
    return () => {
      window.removeEventListener('mouseup', onGlobalUp);
      window.removeEventListener('touchend', onGlobalUp);
    };
  }, [isDrawing, dragMode, drawingShape]);

  // Touch event adapters for mobile/tablet drawing support
  const getPointerPos = (e: React.TouchEvent | React.MouseEvent): { clientX: number; clientY: number } => {
    if ('touches' in e && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if ('changedTouches' in e && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    return { clientX: (e as React.MouseEvent).clientX, clientY: (e as React.MouseEvent).clientY };
  };

  const handlePointerDown = (event: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in event) event.preventDefault();
    if (type !== FlashcardType.IMAGE_OCCLUSION) return;
    const container = imageContainerRef.current;
    if (!container) return;

    // Commit any previously uncommitted shape (e.g. mouseUp fired outside container)
    if (isDrawing && drawingShape) {
      handleFinishDrawing();
    }

    const { clientX, clientY } = getPointerPos(event);
    const rect = container.getBoundingClientRect();
    const startX = normalizeCoord((clientX - rect.left) / rect.width);
    const startY = normalizeCoord((clientY - rect.top) / rect.height);

    setIsDrawing(true);
    setActiveShapeIndex(null);
    setDragMode(null);

    if (occlusionType === 'freeform') {
      setDrawingShape({ type: 'freeform', points: [{ x: startX, y: startY }] });
    } else if (occlusionType === 'circles') {
      setDrawingShape({ type: 'circle', x: startX, y: startY, radius: 0 });
    } else if (occlusionType === 'blur') {
      setDrawingShape({ type: 'blur', x: startX, y: startY, width: 0, height: 0, radius: blurRadius, opacity: blurOpacity });
    } else {
      setDrawingShape({ type: 'rect', x: startX, y: startY, width: 0, height: 0 });
    }
  };

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in event) event.preventDefault();
    const container = imageContainerRef.current;
    if (!container) return;
    const { clientX, clientY } = getPointerPos(event);
    const rect = container.getBoundingClientRect();
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;

    const currentX = normalizeCoord(rawX);
    const currentY = normalizeCoord(rawY);

    if (isDrawing && drawingShape) {
      if (drawingShape.type === 'freeform') {
        setDrawingShape(prev => {
          if (!prev || prev.type !== 'freeform') return prev;
          const last = prev.points[prev.points.length - 1];
          if (last && Math.hypot(currentX - last.x, currentY - last.y) < 0.008) return prev;
          return { ...prev, points: [...prev.points, { x: currentX, y: currentY }] };
        });
      } else if (drawingShape.type === 'circle') {
        const radius = snapValue(Math.max(0, Math.hypot(currentX - drawingShape.x, currentY - drawingShape.y)));
        setDrawingShape({ ...drawingShape, radius });
      } else {
        const x = snapValue(Math.min(drawingShape.x, currentX));
        const y = snapValue(Math.min(drawingShape.y, currentY));
        const width = snapValue(Math.abs(currentX - drawingShape.x));
        const height = snapValue(Math.abs(currentY - drawingShape.y));
        setDrawingShape({ ...drawingShape, x, y, width, height });
      }
      return;
    }

    if (activeShapeIndex !== null && dragStart && dragMode) {
      const dx = currentX - dragStart.x;
      const dy = currentY - dragStart.y;
      setDragStart({ x: currentX, y: currentY });

      if (occlusionData?.type === 'rectangles' && occlusionData.rectangles) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          return {
            ...shape,
            width: snapValue(Math.max(0, shape.width + dx)),
            height: snapValue(Math.max(0, shape.height + dy)),
          };
        });
      } else if (occlusionData?.type === 'circles' && occlusionData.circles) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          const radius = snapValue(Math.max(0, shape.radius + (dx + dy) / 2));
          return { ...shape, radius };
        });
      } else if (occlusionData?.type === 'blur' && occlusionData.blur) {
        updateOcclusionShape(activeShapeIndex, shape => {
          if (dragMode === 'move') {
            return {
              ...shape,
              x: snapValue(shape.x + dx),
              y: snapValue(shape.y + dy),
            };
          }
          return {
            ...shape,
            width: snapValue(Math.max(0, shape.width + dx)),
            height: snapValue(Math.max(0, shape.height + dy)),
          };
        });
      }
    }
  };

  const handleShapePointerDown = (index: number, event: React.MouseEvent | React.TouchEvent, shape: any) => {
    event.stopPropagation();
    if ('touches' in event) event.preventDefault();
    if (type !== FlashcardType.IMAGE_OCCLUSION) return;
    const container = imageContainerRef.current;
    if (!container) return;

    const { clientX, clientY } = getPointerPos(event);
    const rect = container.getBoundingClientRect();
    const startX = snapValue((clientX - rect.left) / rect.width);
    const startY = snapValue((clientY - rect.top) / rect.height);

    setActiveShapeIndex(index);
    setDragStart({ x: startX, y: startY });
    setDragMode(determineDragMode(shape, startX, startY));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deckId) {
        useToastStore.getState().showToast('Please select a deck.', 'error');
        return;
    }

    let cardData: Partial<Omit<Flashcard, 'id' | 'createdAt'>>;

    if (type === FlashcardType.BASIC) {
        if (!front.trim() || !back.trim()) {
            useToastStore.getState().showToast('Front and Back fields are required for a basic card.', 'error');
            return;
        }
        cardData = {
            deckId,
            type,
            front,
            back,
            clozeText: null,
            imageUrl: imageUrl?.trim() ? imageUrl.trim() : undefined,
            occlusionData: undefined,
        };
    } else if (type === FlashcardType.IMAGE_OCCLUSION) {
        if (!imageUrl.trim()) {
            useToastStore.getState().showToast('Please provide an image URL (or upload an image) for image occlusion cards.', 'error');
            return;
        }
        if (!front.trim()) {
            useToastStore.getState().showToast('Please provide a prompt or hint for the image occlusion card.', 'error');
            return;
        }
        cardData = {
            deckId,
            type,
            front,
            back: null,
            clozeText: null,
            imageUrl: imageUrl.trim(),
            occlusionData: occlusionData ?? getEmptyOcclusionData(occlusionType),
        };
    } else { // CLOZE
        if (!clozeText.trim() || !clozeText.includes('{{c1::')) {
            useToastStore.getState().showToast('Cloze text is required and must contain a cloze deletion, e.g., {{c1::answer}}.', 'error');
            return;
        }
        cardData = { deckId, type, clozeText, front: '', back: null, imageUrl: undefined, occlusionData: undefined };
    }
    
    onSubmit({
        id: isEditing ? editingFlashcard.id : undefined,
        ...cardData
    });
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="create-card-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden"
    >
      <div className="flex justify-between items-center px-6 py-4 border-b border-lantern-border flex-shrink-0">
          <h2 id="create-card-modal-title" className="text-xl font-semibold text-lantern-text flex items-center">
            <PlusCircleIcon className="w-6 h-6 mr-2 text-lantern-success" aria-hidden />
            {isEditing ? 'Edit Flashcard' : 'Create New Flashcard'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close flashcard dialog"
          >
            <XCircleIcon className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 bg-lantern-surface">
        {decks.length === 0 ? (
            <div className="text-center p-4 border-2 border-dashed rounded-lg border-lantern-border">
                <p className="text-lantern-text-secondary">You need to create a deck first before adding flashcards.</p>
            </div>
        ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cardType" className="block text-sm font-medium text-lantern-text mb-1">Card Type</label>
                    <select
                      id="cardType"
                      value={type}
                      onChange={e => setType(e.target.value as FlashcardType)}
                      className="w-full p-2 border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border border-lantern-border text-lantern-text dark:text-lantern-text"
                    >
                      <option value={FlashcardType.BASIC}>Basic</option>
                      <option value={FlashcardType.CLOZE}>Cloze</option>
                      <option value={FlashcardType.IMAGE_OCCLUSION}>Image Occlusion</option>
                    </select>
                  </div>
                </div>
                {type === FlashcardType.BASIC ? (
                    <>
                        <div>
                            <label htmlFor="cardFront" className="block text-sm font-medium text-lantern-text">Front</label>
                            <div className="mt-2 flex flex-wrap gap-2 items-center text-xs text-lantern-text-secondary">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingImage}
                                className="px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200"
                              >
                                {isUploadingImage ? 'Uploading…' : 'Upload Image'}
                              </button>
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  await handleUploadImage(file);
                                }}
                              />
                            </div>
                            {imageUrl && (
                              <div className="mt-2">
                                <div className="text-xs text-lantern-text-secondary">Preview:</div>
                                <div
                                  ref={imageContainerRef}
                                  className="relative mt-1 w-full rounded-md border border-lantern-border overflow-hidden cursor-crosshair select-none touch-none"
                                  onMouseDown={handlePointerDown}
                                  onMouseMove={handlePointerMove}
                                  onMouseUp={handleFinishDrawing}
                                  onTouchStart={handlePointerDown}
                                  onTouchMove={handlePointerMove}
                                  onTouchEnd={handleFinishDrawing}
                                >
                                  <img src={imageUrl} alt="Preview" className="w-full h-auto pointer-events-none select-none" draggable={false} />

                                  {/* Existing occlusion shapes */}
                                  {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'rectangles' && occlusionData.rectangles?.map((rect, idx) => (
                                    <div
                                      key={idx}
                                      className={`absolute bg-black/70 border border-white/40 ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                      style={{
                                        left: `${rect.x * 100}%`,
                                        top: `${rect.y * 100}%`,
                                        width: `${rect.width * 100}%`,
                                        height: `${rect.height * 100}%`,
                                      }}
                                      onMouseDown={(e) => {
                                        handleShapePointerDown(idx, e, rect);
                                      }}
                                      onTouchStart={(e) => {
                                        handleShapePointerDown(idx, e, rect);
                                      }}
                                      title="Drag to move, drag edge to resize"
                                    />
                                  ))}
                                  {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'circles' && occlusionData.circles?.map((circle, idx) => (
                                    <div
                                      key={idx}
                                      className={`absolute bg-black/70 border border-white/40 rounded-full ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                      style={{
                                        left: `${(circle.x - circle.radius) * 100}%`,
                                        top: `${(circle.y - circle.radius) * 100}%`,
                                        width: `${circle.radius * 2 * 100}%`,
                                        height: `${circle.radius * 2 * 100}%`,
                                      }}
                                      onMouseDown={(e) => handleShapePointerDown(idx, e, circle)}
                                      onTouchStart={(e) => handleShapePointerDown(idx, e, circle)}
                                      title="Drag to move, drag edge to resize"
                                    />
                                  ))}
                                  {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'freeform' && (
                                    <FreeformMaskSvg paths={getFreeformPaths(occlusionData)} />
                                  )}
                                  {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'blur' &&
                                    getBlurRegions(occlusionData).map((blur, idx) => (
                                      <div
                                        key={idx}
                                        className={`absolute border border-white/40 ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                        style={{
                                          left: `${blur.x * 100}%`,
                                          top: `${blur.y * 100}%`,
                                          width: `${blur.width * 100}%`,
                                          height: `${blur.height * 100}%`,
                                          backdropFilter: `blur(${blur.radius * 40}px)`,
                                          backgroundColor: `rgba(255,255,255,${blur.opacity ?? 0.4})`,
                                        }}
                                        onMouseDown={e => handleShapePointerDown(idx, e, blur)}
                                        onTouchStart={e => handleShapePointerDown(idx, e, blur)}
                                        title="Drag to move, drag edge to resize"
                                      />
                                    ))}

                                  {/* Currently drawing */}
                                  {drawingShape && drawingShape.type === 'rect' && (
                                    <div
                                      className="absolute bg-black/50 border border-white/60"
                                      style={{
                                        left: `${drawingShape.x * 100}%`,
                                        top: `${drawingShape.y * 100}%`,
                                        width: `${drawingShape.width * 100}%`,
                                        height: `${drawingShape.height * 100}%`,
                                      }}
                                    />
                                  )}
                                  {drawingShape && drawingShape.type === 'circle' && (
                                    <div
                                      className="absolute bg-black/50 border border-white/60 rounded-full"
                                      style={{
                                        left: `${(drawingShape.x - drawingShape.radius) * 100}%`,
                                        top: `${(drawingShape.y - drawingShape.radius) * 100}%`,
                                        width: `${drawingShape.radius * 2 * 100}%`,
                                        height: `${drawingShape.radius * 2 * 100}%`,
                                      }}
                                    />
                                  )}
                                  {drawingShape && drawingShape.type === 'blur' && (
                                    <div
                                      className="absolute border border-white/60"
                                      style={{
                                        left: `${drawingShape.x * 100}%`,
                                        top: `${drawingShape.y * 100}%`,
                                        width: `${drawingShape.width * 100}%`,
                                        height: `${drawingShape.height * 100}%`,
                                        backdropFilter: `blur(${drawingShape.radius * 40}px)`,
                                        backgroundColor: 'rgba(255,255,255,0.4)',
                                      }}
                                    />
                                  )}
                                </div>

                                {type === FlashcardType.IMAGE_OCCLUSION && (
                                  <div className="mt-2">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-lantern-text-secondary">
                                      <div>
                                        <span className="font-medium">Mask type:</span>
                                        <select
                                          value={occlusionType}
                                          onChange={e => setOcclusionType(e.target.value as OcclusionType)}
                                          className="ml-2 px-2 py-1 rounded-md border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"
                                        >
                                          <option value="rectangles">Rectangle</option>
                                          <option value="circles">Circle</option>
                                          <option value="freeform">Freeform</option>
                                          <option value="blur">Blur Gradient</option>
                                        </select>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-lantern-text-secondary">Click+drag to draw. Drag shape to move, drag near edge to resize.</span>
                                        <button type="button" onClick={clearOcclusions} className="text-lantern-primary hover:underline">Clear</button>
                                      </div>
                                    </div>

                                    {occlusionData?.type === 'rectangles' && occlusionData.rectangles?.length ? (
                                      <div className="mt-2 space-y-1 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                        {occlusionData.rectangles.map((rect, idx) => (
                                          <div key={idx} className="flex justify-between items-center">
                                            <span>Box {idx + 1}</span>
                                            <button
                                              type="button"
                                              onClick={() => removeOcclusionShape(idx)}
                                              className="text-red-600 dark:text-red-400 hover:underline"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}

                                    {occlusionData?.type === 'circles' && occlusionData.circles?.length ? (
                                      <div className="mt-2 space-y-1 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                        {occlusionData.circles.map((circle, idx) => (
                                          <div key={idx} className="flex justify-between items-center">
                                            <span>Circle {idx + 1}</span>
                                            <button
                                              type="button"
                                              onClick={() => removeOcclusionShape(idx)}
                                              className="text-red-600 dark:text-red-400 hover:underline"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}

                                    {occlusionData?.type === 'freeform' && occlusionData.freeform?.points?.length ? (
                                      <div className="mt-2 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary flex justify-between items-center">
                                        <span>Freeform mask</span>
                                        <button type="button" onClick={() => setOcclusionData(getEmptyOcclusionData('freeform'))} className="text-red-600 dark:text-red-400 hover:underline">Clear</button>
                                      </div>
                                    ) : null}

                                    {occlusionData?.type === 'blur' && occlusionData.blur ? (
                                      <div className="mt-2 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                        <div className="flex justify-between items-center">
                                          <span>Blur masks</span>
                                          <button type="button" onClick={() => setOcclusionData(getEmptyOcclusionData('blur'))} className="text-red-600 dark:text-red-400 hover:underline">Clear</button>
                                        </div>
                                        <div className="mt-2 space-y-1">
                                          {occlusionData.blur.map((blur, idx) => (
                                            <div key={idx} className="flex justify-between items-center">
                                              <button
                                                type="button"
                                                onClick={() => setActiveShapeIndex(idx)}
                                                className={`text-left flex-1 text-xs ${activeShapeIndex === idx ? 'font-semibold text-lantern-primary dark:text-blue-300' : 'text-lantern-text-secondary dark:text-lantern-text-tertiary'}`}
                                              >
                                                Blur {idx + 1}
                                              </button>
                                              <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-lantern-text-secondary">{Math.round(blur.radius * 100)}%</span>
                                                <span className="text-[10px] text-lantern-text-secondary">{Math.round(blur.opacity * 100)}%</span>
                                                <button
                                                  type="button"
                                                  onClick={() => removeOcclusionShape(idx)}
                                                  className="text-red-600 dark:text-red-400 hover:underline"
                                                >
                                                  Delete
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        {activeShapeIndex !== null && occlusionData.blur[activeShapeIndex] && (
                                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">Radius</span>
                                              <input
                                                type="range"
                                                min={0.01}
                                                max={0.5}
                                                step={0.01}
                                                value={occlusionData.blur[activeShapeIndex].radius}
                                                onChange={e => updateOcclusionShape(activeShapeIndex, blur => ({ ...blur, radius: parseFloat(e.target.value) }))}
                                                className="w-full"
                                              />
                                              <span>{Math.round(occlusionData.blur[activeShapeIndex].radius * 100)}%</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">Opacity</span>
                                              <input
                                                type="range"
                                                min={0.1}
                                                max={1}
                                                step={0.05}
                                                value={occlusionData.blur[activeShapeIndex].opacity}
                                                onChange={e => updateOcclusionShape(activeShapeIndex, blur => ({ ...blur, opacity: parseFloat(e.target.value) }))}
                                                className="w-full"
                                              />
                                              <span>{Math.round(occlusionData.blur[activeShapeIndex].opacity * 100)}%</span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            )}
                            <textarea ref={frontRef} id="cardFront" value={front} onChange={e => setFront(e.target.value)} rows={3} className="w-full p-2 mt-1 border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary" placeholder="Enter the front text for the flashcard"/>
                        </div>
                        <div>
                            <label htmlFor="cardBack" className="block text-sm font-medium text-lantern-text">Back</label>
                            <textarea ref={backRef} id="cardBack" value={back} onChange={e => setBack(e.target.value)} rows={3} className="w-full p-2 mt-1 border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary" placeholder="Enter the back text for the flashcard"/>
                        </div>
                        {onEnhanceFlashcard && front.trim() && back.trim() && (
                          <button
                            type="button"
                            onClick={async () => {
                              setIsEnhancing(true);
                              const enhanced = await onEnhanceFlashcard(front, back);
                              if (enhanced) {
                                setFront(enhanced.front);
                                setBack(enhanced.back + (enhanced.mnemonic ? `\n\n💡 ${enhanced.mnemonic}` : '') + (enhanced.example ? `\n📝 ${enhanced.example}` : ''));
                              }
                              setIsEnhancing(false);
                            }}
                            disabled={isEnhancing}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-lantern-primary bg-lantern-primary-background hover:bg-lantern-primary-background border border-lantern-primary/30 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <SparklesIcon className={`w-4 h-4 ${isEnhancing ? 'animate-pulse' : ''}`} />
                            {isEnhancing ? 'Enhancing...' : 'Enhance with AI'}
                          </button>
                        )}
                        {onEnhanceFlashcard && front.trim() && back.trim() && <AIUsageInline className="ml-1" />}
                    </>
                ) : type === FlashcardType.IMAGE_OCCLUSION ? (
                    <div>
                        <label htmlFor="cardFront" className="block text-sm font-medium text-lantern-text">Prompt</label>
                        <textarea ref={frontRef} id="cardFront" value={front} onChange={e => setFront(e.target.value)} rows={3} className="w-full p-2 mt-1 border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary" placeholder="Optional hint or prompt for this image" />
                        <div className="mt-2 flex flex-wrap gap-2 items-center text-xs text-lantern-text-secondary">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploadingImage}
                            className="px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200"
                          >
                            {isUploadingImage ? 'Uploading…' : 'Upload Image'}
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              await handleUploadImage(file);
                            }}
                          />
                        </div>
                        {imageUrl && (
                          <div className="mt-2">
                            <div className="text-xs text-lantern-text-secondary">Preview:</div>
                            <div
                              ref={imageContainerRef}
                              className="relative mt-1 w-full rounded-md border border-lantern-border overflow-hidden cursor-crosshair select-none touch-none"
                              onMouseDown={handlePointerDown}
                              onMouseMove={handlePointerMove}
                              onMouseUp={handleFinishDrawing}
                              onTouchStart={handlePointerDown}
                              onTouchMove={handlePointerMove}
                              onTouchEnd={handleFinishDrawing}
                            >
                              <img src={imageUrl} alt="Preview" className="w-full h-auto pointer-events-none select-none" draggable={false} />

                              {/* Existing occlusion shapes */}
                              {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'rectangles' && occlusionData.rectangles?.map((rect, idx) => (
                                <div
                                  key={idx}
                                  className={`absolute bg-black/70 border border-white/40 ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                  style={{
                                    left: `${rect.x * 100}%`,
                                    top: `${rect.y * 100}%`,
                                    width: `${rect.width * 100}%`,
                                    height: `${rect.height * 100}%`,
                                  }}
                                  onMouseDown={(e) => {
                                    handleShapeMouseDown(idx, e, rect);
                                  }}
                                  title="Drag to move, drag edge to resize"
                                />
                              ))}
                              {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'circles' && occlusionData.circles?.map((circle, idx) => (
                                <div
                                  key={idx}
                                  className={`absolute bg-black/70 border border-white/40 rounded-full ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                  style={{
                                    left: `${(circle.x - circle.radius) * 100}%`,
                                    top: `${(circle.y - circle.radius) * 100}%`,
                                    width: `${circle.radius * 2 * 100}%`,
                                    height: `${circle.radius * 2 * 100}%`,
                                  }}
                                  onMouseDown={(e) => handleShapeMouseDown(idx, e, circle)}
                                  title="Drag to move, drag edge to resize"
                                />
                              ))}
                              {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'freeform' && (
                                <FreeformMaskSvg paths={getFreeformPaths(occlusionData)} />
                              )}
                              {type === FlashcardType.IMAGE_OCCLUSION && occlusionData?.type === 'blur' &&
                                getBlurRegions(occlusionData).map((blur, idx) => (
                                  <div
                                    key={idx}
                                    className={`absolute border border-white/40 ${activeShapeIndex === idx ? 'ring-2 ring-blue-300' : ''}`}
                                    style={{
                                      left: `${blur.x * 100}%`,
                                      top: `${blur.y * 100}%`,
                                      width: `${blur.width * 100}%`,
                                      height: `${blur.height * 100}%`,
                                      backdropFilter: `blur(${blur.radius * 40}px)`,
                                      backgroundColor: `rgba(255,255,255,${blur.opacity ?? 0.4})`,
                                    }}
                                    onMouseDown={e => handleShapePointerDown(idx, e, blur)}
                                    onTouchStart={e => handleShapePointerDown(idx, e, blur)}
                                    title="Drag to move, drag edge to resize"
                                  />
                                ))}

                              {/* Currently drawing */}
                              {drawingShape && drawingShape.type === 'rect' && (
                                <div
                                  className="absolute bg-black/50 border border-white/60"
                                  style={{
                                    left: `${drawingShape.x * 100}%`,
                                    top: `${drawingShape.y * 100}%`,
                                    width: `${drawingShape.width * 100}%`,
                                    height: `${drawingShape.height * 100}%`,
                                  }}
                                />
                              )}
                              {drawingShape && drawingShape.type === 'circle' && (
                                <div
                                  className="absolute bg-black/50 border border-white/60 rounded-full"
                                  style={{
                                    left: `${(drawingShape.x - drawingShape.radius) * 100}%`,
                                    top: `${(drawingShape.y - drawingShape.radius) * 100}%`,
                                    width: `${drawingShape.radius * 2 * 100}%`,
                                    height: `${drawingShape.radius * 2 * 100}%`,
                                  }}
                                />
                              )}
                              {drawingShape && drawingShape.type === 'freeform' && drawingShape.points.length > 1 && (
                                <FreeformMaskSvg paths={[{ points: drawingShape.points }]} className="opacity-80" />
                              )}
                              {drawingShape && drawingShape.type === 'blur' && (
                                <div
                                  className="absolute border border-white/60"
                                  style={{
                                    left: `${drawingShape.x * 100}%`,
                                    top: `${drawingShape.y * 100}%`,
                                    width: `${drawingShape.width * 100}%`,
                                    height: `${drawingShape.height * 100}%`,
                                    backdropFilter: `blur(${drawingShape.radius * 40}px)`,
                                    backgroundColor: 'rgba(255,255,255,0.4)',
                                  }}
                                />
                              )}
                            </div>

                            <div className="mt-2">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-lantern-text-secondary">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">Mask type:</span>
                                  <select
                                    value={occlusionType}
                                    onChange={e => setOcclusionType(e.target.value as OcclusionType)}
                                    className="ml-2 px-2 py-1 rounded-md border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"
                                  >
                                    <option value="rectangles">Rectangle</option>
                                    <option value="circles">Circle</option>
                                    <option value="freeform">Freeform</option>
                                    <option value="blur">Blur Gradient</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-lantern-text-secondary">
                                    {occlusionType === 'freeform'
                                      ? 'Click+drag to trace each area. Release to save the shape.'
                                      : 'Click+drag to draw. Drag shape to move, drag near edge to resize.'}
                                  </span>
                                  <button type="button" onClick={clearOcclusions} className="text-lantern-primary hover:underline">Clear</button>
                                </div>
                              </div>

                              <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-lantern-text-secondary">
                                <div className="flex items-center gap-2">
                                  <label className="font-medium">Snap to grid</label>
                                  <input
                                    type="checkbox"
                                    checked={snapToGrid}
                                    onChange={e => setSnapToGrid(e.target.checked)}
                                    className="h-4 w-4"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="font-medium">Grid size</label>
                                  <select
                                    value={gridSize}
                                    onChange={e => setGridSize(parseFloat(e.target.value))}
                                    className="px-2 py-1 rounded-md border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text"
                                  >
                                    <option value={0.05}>5%</option>
                                    <option value={0.025}>2.5%</option>
                                    <option value={0.02}>2%</option>
                                    <option value={0.01}>1%</option>
                                  </select>
                                </div>
                              </div>

                              {occlusionType === 'blur' && (
                                <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-lantern-text-secondary">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">Blur radius</span>
                                    <input
                                      type="range"
                                      min={0.01}
                                      max={0.5}
                                      step={0.01}
                                      value={blurRadius}
                                      onChange={e => setBlurRadius(parseFloat(e.target.value))}
                                      className="w-32"
                                    />
                                    <span>{Math.round(blurRadius * 100)}%</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">Opacity</span>
                                    <input
                                      type="range"
                                      min={0.1}
                                      max={1}
                                      step={0.05}
                                      value={blurOpacity}
                                      onChange={e => setBlurOpacity(parseFloat(e.target.value))}
                                      className="w-32"
                                    />
                                    <span>{Math.round(blurOpacity * 100)}%</span>
                                  </div>
                                </div>
                              )}

                              {occlusionData?.type === 'rectangles' && occlusionData.rectangles?.length ? (
                                <div className="mt-2 space-y-1 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                  {occlusionData.rectangles.map((rect, idx) => (
                                    <div key={idx} className="flex justify-between items-center">
                                      <span>Box {idx + 1}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeOcclusionShape(idx)}
                                        className="text-red-600 dark:text-red-400 hover:underline"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {occlusionData?.type === 'circles' && occlusionData.circles?.length ? (
                                <div className="mt-2 space-y-1 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                  {occlusionData.circles.map((circle, idx) => (
                                    <div key={idx} className="flex justify-between items-center">
                                      <span>Circle {idx + 1}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeOcclusionShape(idx)}
                                        className="text-red-600 dark:text-red-400 hover:underline"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {occlusionData?.type === 'freeform' && getFreeformPaths(occlusionData).length ? (
                                <div className="mt-2 space-y-1 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                  {getFreeformPaths(occlusionData).map((_, idx) => (
                                    <div key={idx} className="flex justify-between items-center">
                                      <span>Freeform {idx + 1}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeOcclusionShape(idx)}
                                        className="text-red-600 dark:text-red-400 hover:underline"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {occlusionData?.type === 'blur' && getBlurRegions(occlusionData).length ? (
                                <div className="mt-2 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                  <div className="flex justify-between items-center">
                                    <span>Blur masks ({getBlurRegions(occlusionData).length})</span>
                                    <button type="button" onClick={() => setOcclusionData(getEmptyOcclusionData('blur'))} className="text-red-600 dark:text-red-400 hover:underline">Clear all</button>
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    {getBlurRegions(occlusionData).map((blur, idx) => (
                                      <div key={idx} className="flex justify-between items-center">
                                        <button
                                          type="button"
                                          onClick={() => setActiveShapeIndex(idx)}
                                          className={`text-left flex-1 text-xs ${activeShapeIndex === idx ? 'font-semibold text-lantern-primary dark:text-blue-300' : 'text-lantern-text-secondary dark:text-lantern-text-tertiary'}`}
                                        >
                                          Blur {idx + 1}
                                        </button>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-lantern-text-secondary">{Math.round(blur.radius * 100)}%</span>
                                          <span className="text-[10px] text-lantern-text-secondary">{Math.round(blur.opacity * 100)}%</span>
                                          <button
                                            type="button"
                                            onClick={() => removeOcclusionShape(idx)}
                                            className="text-red-600 dark:text-red-400 hover:underline"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {activeShapeIndex !== null && occlusionData.blur?.[activeShapeIndex] && (
                                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-lantern-text-secondary dark:text-lantern-text-tertiary">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">Radius</span>
                                        <input
                                          type="range"
                                          min={0.01}
                                          max={0.5}
                                          step={0.01}
                                          value={occlusionData.blur[activeShapeIndex].radius}
                                          onChange={e => updateOcclusionShape(activeShapeIndex, blur => ({ ...blur, radius: parseFloat(e.target.value) }))}
                                          className="w-full"
                                        />
                                        <span>{Math.round(occlusionData.blur[activeShapeIndex].radius * 100)}%</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">Opacity</span>
                                        <input
                                          type="range"
                                          min={0.1}
                                          max={1}
                                          step={0.05}
                                          value={occlusionData.blur[activeShapeIndex].opacity}
                                          onChange={e => updateOcclusionShape(activeShapeIndex, blur => ({ ...blur, opacity: parseFloat(e.target.value) }))}
                                          className="w-full"
                                        />
                                        <span>{Math.round(occlusionData.blur[activeShapeIndex].opacity * 100)}%</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                    </div>
                ) : (
                    <div>
                        <label htmlFor="cardCloze" className="block text-sm font-medium text-lantern-text">Cloze Text</label>
                        <textarea id="cardCloze" value={clozeText} onChange={e => setClozeText(e.target.value)} rows={4} className="w-full p-2 mt-1 border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary dark:border-lantern-border border-lantern-border text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary" placeholder="e.g., The powerhouse of the cell is the {{c1::mitochondria}}."/>
                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-md">
                            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-start">
                                <InformationCircleIcon className="w-4 h-4 mr-1.5 flex-shrink-0 mt-0.5" />
                                <span>Wrap the text you want to hide in double curly braces, like this: <code className="font-semibold">{`{{c1::your answer}}`}</code>.</span>
                            </p>
                        </div>
                    </div>
                )}
              
                <div className="flex justify-end space-x-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-md dark:bg-lantern-surface-secondary dark:text-lantern-text-tertiary dark:border-lantern-border hover:bg-lantern-background-secondary dark:hover:bg-lantern-border">Cancel</button>
                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm dark:bg-green-500 dark:hover:bg-green-600">{isEditing ? 'Save Changes' : 'Create Card'}</button>
                </div>
            </form>
        )}
        </div>
    </Modal>
  );
};

export default CreateFlashcardModal;