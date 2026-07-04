import React, { useState, useEffect, useReducer, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { QuestionType, QuestionOption, MatchingItem, DiagramLabel } from '../types';
import { PlusCircleIcon, TrashIcon, PhotoIcon, XCircleIcon, TagIcon, CheckIcon, InformationCircleIcon, MapPinIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import VoiceInputButton from './VoiceInputButton';
import { v4 as uuidv4 } from 'uuid';
import { uploadQuestionImage } from '../services/supabase';

interface QuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    stem: string, 
    explanation: string, 
    questionType: QuestionType, 
    options?: QuestionOption[], 
    correctAnswerIds?: string[], 
    imageUrl?: string,
    tags?: string[],
    acceptableAnswers?: string[], 
    matchingPromptItems?: MatchingItem[],
    matchingAnswerItems?: MatchingItem[],
    correctMatches?: { promptItemId: string; answerItemId: string }[],
    diagramLabels?: DiagramLabel[]
  ) => void;
  groupName: string;
  isSubmitting?: boolean;
}

interface FormState {
  questionType: QuestionType;
  stem: string;
  explanation: string;
  options: QuestionOption[];
  correctAnswerIdsSelected: string[];
  selectedImageFile: File | null;
  imagePreviewUrl: string | null;
  tagsInput: string;
  acceptableAnswersInput: string;
  promptItems: MatchingItem[];
  answerItems: MatchingItem[];
  matchSelections: Record<string, string>; 
  diagramLabels: DiagramLabel[];
}

const initialFormState: FormState = {
  questionType: QuestionType.MULTIPLE_CHOICE_SINGLE,
  stem: '',
  explanation: '',
  options: [{ id: uuidv4(), text: '' }, { id: uuidv4(), text: '' }],
  correctAnswerIdsSelected: [],
  selectedImageFile: null,
  imagePreviewUrl: null,
  tagsInput: '',
  acceptableAnswersInput: '',
  promptItems: [{id: uuidv4(), text: ''}],
  answerItems: [{id: uuidv4(), text: ''}],
  matchSelections: {},
  diagramLabels: [],
};

function formReducer(state: FormState, action: any): FormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_QUESTION_TYPE':
      return { 
        ...initialFormState, 
        questionType: action.value,
        stem: state.stem, 
        explanation: state.explanation,
        tagsInput: state.tagsInput,
        selectedImageFile: state.selectedImageFile,
        imagePreviewUrl: state.imagePreviewUrl,
      };
    case 'SET_OPTIONS':
      return { ...state, options: action.value };
    case 'SET_CORRECT_ANSWER_IDS':
      return { ...state, correctAnswerIdsSelected: action.value };
    case 'ADD_OPTION':
      if (state.options.length < 6) {
        return { ...state, options: [...state.options, { id: uuidv4(), text: '' }] };
      }
      return state;
    case 'REMOVE_OPTION':
      if (state.options.length > 2) {
        const newOptions = state.options.filter(opt => opt.id !== action.id);
        const newCorrectIds = state.correctAnswerIdsSelected.filter(id => id !== action.id);
        return { ...state, options: newOptions, correctAnswerIdsSelected: newCorrectIds };
      }
      return state;
    case 'UPDATE_OPTION_TEXT':
      return {
        ...state,
        options: state.options.map(opt => opt.id === action.id ? { ...opt, text: action.text } : opt),
      };
    case 'SET_IMAGE':
      if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
      return { ...state, selectedImageFile: action.file, imagePreviewUrl: action.previewUrl };
    case 'REMOVE_IMAGE':
      if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
      return { ...state, selectedImageFile: null, imagePreviewUrl: null, diagramLabels: [] };
    case 'ADD_MATCHING_ITEM': {
      const { itemType } = action; 
      const newItem = { id: uuidv4(), text: '' };
      if (itemType === 'prompt') {
        return { ...state, promptItems: [...state.promptItems, newItem] };
      } else {
        return { ...state, answerItems: [...state.answerItems, newItem] };
      }
    }
    case 'REMOVE_MATCHING_ITEM': {
      const { itemType, id } = action;
      if (itemType === 'prompt') {
        if (state.promptItems.length <= 1) return state; 
        const newMatchSelections = { ...state.matchSelections };
        delete newMatchSelections[id]; 
        return { ...state, promptItems: state.promptItems.filter(item => item.id !== id), matchSelections: newMatchSelections };
      } else { 
        if (state.answerItems.length <= 1) return state;
         const newMatchSelections = { ...state.matchSelections };
        Object.keys(newMatchSelections).forEach(promptId => {
          if (newMatchSelections[promptId] === id) {
            delete newMatchSelections[promptId]; 
          }
        });
        return { ...state, answerItems: state.answerItems.filter(item => item.id !== id), matchSelections: newMatchSelections };
      }
    }
    case 'UPDATE_MATCHING_ITEM_TEXT': {
      const { itemType, id, text } = action;
      if (itemType === 'prompt') {
        return { ...state, promptItems: state.promptItems.map(item => item.id === id ? { ...item, text } : item) };
      } else { 
        return { ...state, answerItems: state.answerItems.map(item => item.id === id ? { ...item, text } : item) };
      }
    }
    case 'SET_MATCH_SELECTION': {
        const { promptItemId, answerItemId } = action;
        const newSelections = { ...state.matchSelections };
        if (answerItemId === "") { 
            delete newSelections[promptItemId];
        } else {
            newSelections[promptItemId] = answerItemId;
        }
        return { ...state, matchSelections: newSelections };
    }
    case 'ADD_DIAGRAM_LABEL':
        return {...state, diagramLabels: [...state.diagramLabels, {id: uuidv4(), text: '', x: action.x, y: action.y}]}
    case 'REMOVE_DIAGRAM_LABEL':
        return {...state, diagramLabels: state.diagramLabels.filter(label => label.id !== action.id)}
    case 'UPDATE_DIAGRAM_LABEL_TEXT':
        return {...state, diagramLabels: state.diagramLabels.map(label => label.id === action.id ? {...label, text: action.text} : label)}
    case 'UPDATE_DIAGRAM_LABEL_POSITION':
        return {...state, diagramLabels: state.diagramLabels.map(label => label.id === action.id ? {...label, x: action.x, y: action.y} : label)}
    case 'RESET_FORM':
      if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
      return initialFormState;
    default:
      return state;
  }
}

const QuestionModal: React.FC<QuestionModalProps> = ({ isOpen, onClose, onSubmit, groupName, isSubmitting = false }) => {
  const [state, dispatch] = useReducer(formReducer, initialFormState);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [draggingLabelId, setDraggingLabelId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      dispatch({ type: 'RESET_FORM' });
    }
  }, [isOpen]);

  useEffect(() => {
    const currentPreviewUrl = state.imagePreviewUrl;
    return () => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }
    };
  }, [state.imagePreviewUrl]);
  
  const handleMouseMove = (e: MouseEvent) => {
    if (!draggingLabelId || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Clamp values to be within 0-100%
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));

    dispatch({type: 'UPDATE_DIAGRAM_LABEL_POSITION', id: draggingLabelId, x, y});
  };

  const handleMouseUp = () => {
    setDraggingLabelId(null);
  };
  
  useEffect(() => {
    if (draggingLabelId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingLabelId]);


  if (!isOpen) return null;

  const handleFieldChange = (field: keyof FormState, value: any) => {
    dispatch({ type: 'SET_FIELD', field, value });
  };
  
  const handleQuestionTypeChange = (value: QuestionType) => {
    dispatch({ type: 'SET_QUESTION_TYPE', value });
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      dispatch({ type: 'SET_IMAGE', file, previewUrl: URL.createObjectURL(file) });
    } else {
      dispatch({ type: 'SET_IMAGE', file: null, previewUrl: null });
    }
  };

  const handleRemoveImage = () => {
    dispatch({ type: 'REMOVE_IMAGE' });
    const fileInput = document.getElementById('questionImage') as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };
  
  const handleAddOption = () => dispatch({ type: 'ADD_OPTION' });
  const handleRemoveOption = (id: string) => dispatch({ type: 'REMOVE_OPTION', id });
  const handleOptionTextChange = (id: string, text: string) => dispatch({ type: 'UPDATE_OPTION_TEXT', id, text });

  const handleMcqCorrectAnswerChange = (optionId: string, isMultipleType: boolean) => {
    let newCorrectIds: string[];
    if (isMultipleType) {
      if (state.correctAnswerIdsSelected.includes(optionId)) {
        newCorrectIds = state.correctAnswerIdsSelected.filter(id => id !== optionId);
      } else {
        newCorrectIds = [...state.correctAnswerIdsSelected, optionId];
      }
    } else { 
      newCorrectIds = [optionId];
    }
    dispatch({ type: 'SET_CORRECT_ANSWER_IDS', value: newCorrectIds });
  };

  const handleAddMatchingItem = (itemType: 'prompt' | 'answer') => dispatch({ type: 'ADD_MATCHING_ITEM', itemType });
  const handleRemoveMatchingItem = (itemType: 'prompt' | 'answer', id: string) => dispatch({ type: 'REMOVE_MATCHING_ITEM', itemType, id });
  const handleMatchingItemTextChange = (itemType: 'prompt' | 'answer', id: string, text: string) => dispatch({ type: 'UPDATE_MATCHING_ITEM_TEXT', itemType, id, text });
  const handleMatchSelectionChange = (promptItemId: string, answerItemId: string) => dispatch({ type: 'SET_MATCH_SELECTION', promptItemId, answerItemId });

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    dispatch({ type: 'ADD_DIAGRAM_LABEL', x, y });
  }


  const isFormValid = () => {
    if (!state.stem.trim() || !state.explanation.trim()) return false;
    switch (state.questionType) {
      case QuestionType.MULTIPLE_CHOICE_SINGLE:
      case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
        if (state.options.some(opt => !opt.text.trim()) || state.options.length < 2 || state.correctAnswerIdsSelected.length === 0) return false;
        if (state.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE && state.correctAnswerIdsSelected.length > 1) return false;
        break;
      case QuestionType.TRUE_FALSE:
        if (state.correctAnswerIdsSelected.length !== 1) return false;
        break;
      case QuestionType.FILL_IN_THE_BLANK:
        if (!state.acceptableAnswersInput.trim()) return false;
        if (!state.stem.includes("___")) {
          return false;
        }
        break;
      case QuestionType.MATCHING:
        if (state.promptItems.some(p => !p.text.trim()) || state.answerItems.some(a => !a.text.trim())) return false;
        if (state.promptItems.length === 0 || state.answerItems.length === 0) return false;
        if (Object.keys(state.matchSelections).length !== state.promptItems.length) return false; 
        if (Object.values(state.matchSelections).some(selectedAnswerId => !state.answerItems.find(ai => ai.id === selectedAnswerId))) return false;
        break;
      case QuestionType.DIAGRAM_LABELING:
        if (!state.imagePreviewUrl || state.diagramLabels.length === 0 || state.diagramLabels.some(l => !l.text.trim())) return false;
        break;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('QuestionModal handleSubmit called, isFormValid:', isFormValid());
    if (!isFormValid()) {
        console.log('Form is not valid:', { 
          stem: state.stem, 
          explanation: state.explanation, 
          questionType: state.questionType,
          options: state.options,
          correctAnswerIdsSelected: state.correctAnswerIdsSelected
        });
        if(state.questionType === QuestionType.FILL_IN_THE_BLANK && !state.stem.includes("___")) {
            useToastStore.getState().showToast("For Fill-in-the-Blank questions, please use '___' (three underscores) to indicate where the blank should appear in the question stem.", 'error');
        } else if (state.questionType === QuestionType.DIAGRAM_LABELING) {
            useToastStore.getState().showToast("For Diagram Labeling questions, please ensure you have uploaded an image, added at least one label pin, and filled in all label texts.", 'error');
        }
        return;
    }
    
    let imageUrl: string | undefined = undefined;
    if (state.selectedImageFile) {
      try {
        const { url } = await uploadQuestionImage(state.selectedImageFile);
        imageUrl = url;
      } catch (error) {
        console.error('Error uploading image:', error);
        useToastStore.getState().showToast(
          error instanceof Error && error.message.includes('signed in')
            ? 'You must be signed in to upload an image. Please log in and try again.'
            : 'Failed to upload image. Please try again.',
          'error'
        );
        return;
      }
    }

    const parsedTags = state.tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
    
    let submissionData: any = {
      stem: state.stem,
      explanation: state.explanation,
      questionType: state.questionType,
      imageUrl: imageUrl,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
    };

    switch (state.questionType) {
      case QuestionType.MULTIPLE_CHOICE_SINGLE:
      case QuestionType.MULTIPLE_CHOICE_MULTIPLE:
        submissionData.options = state.options.filter(opt => opt.text.trim());
        submissionData.correctAnswerIds = state.correctAnswerIdsSelected;
        break;
      case QuestionType.TRUE_FALSE:
        submissionData.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
        submissionData.correctAnswerIds = state.correctAnswerIdsSelected;
        break;
      case QuestionType.FILL_IN_THE_BLANK:
        submissionData.acceptableAnswers = state.acceptableAnswersInput.split(',').map(a => a.trim()).filter(a => a);
        break;
      case QuestionType.MATCHING:
        submissionData.matchingPromptItems = state.promptItems.filter(p => p.text.trim());
        submissionData.matchingAnswerItems = state.answerItems.filter(a => a.text.trim());
        submissionData.correctMatches = Object.entries(state.matchSelections)
            .map(([promptItemId, answerItemId]) => ({ promptItemId, answerItemId }))
            .filter(match => state.promptItems.find(p=>p.id === match.promptItemId) && state.answerItems.find(a=>a.id === match.answerItemId));
        break;
      case QuestionType.DIAGRAM_LABELING:
        submissionData.diagramLabels = state.diagramLabels;
        break;
    }
    
    onSubmit(
      submissionData.stem, 
      submissionData.explanation, 
      submissionData.questionType, 
      submissionData.options, 
      submissionData.correctAnswerIds, 
      submissionData.imageUrl, 
      submissionData.tags,
      submissionData.acceptableAnswers,
      submissionData.matchingPromptItems,
      submissionData.matchingAnswerItems,
      submissionData.correctMatches,
      submissionData.diagramLabels
    );
  };
  
  const renderMCQOptions = (isMultipleType: boolean) => (
    <div className="mb-4 space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Answer Options (select correct one/ones)</label>
      {state.options.map((option, index) => (
        <div key={option.id} className="flex items-center space-x-2">
          <input
            type={isMultipleType ? "checkbox" : "radio"}
            id={`option-check-${option.id}`}
            name={isMultipleType ? `option-check-${option.id}` : "correctAnswerSingle"}
            checked={state.correctAnswerIdsSelected.includes(option.id)}
            onChange={() => handleMcqCorrectAnswerChange(option.id, isMultipleType)}
            className={`h-4 w-4 ${isMultipleType ? 'rounded' : 'rounded-full'} text-blue-600 border-gray-300 dark:border-gray-500 focus:ring-blue-500`}
          />
          <div className="flex-1 relative">
            <input
              type="text"
              value={option.text}
              onChange={(e) => handleOptionTextChange(option.id, e.target.value)}
              placeholder={`Option ${index + 1}`}
              className="w-full p-2 pr-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              required
            />
            <VoiceInputButton
              className="absolute top-1/2 right-2 -translate-y-1/2"
              onTranscriptUpdate={(text) => handleOptionTextChange(option.id, option.text + text)}
            />
          </div>
          {state.options.length > 2 && (
            <button type="button" onClick={() => handleRemoveOption(option.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" aria-label={`Remove option ${index + 1}`}>
              <TrashIcon className="w-5 h-5" />
            </button>
          )}
        </div>
      ))}
      {state.options.length < 6 && (
        <button type="button" onClick={handleAddOption} className="mt-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center">
          <PlusCircleIcon className="w-5 h-5 mr-1" /> Add Option
        </button>
      )}
      {isMultipleType && (
        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-md">
            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-start">
                <InformationCircleIcon className="w-4 h-4 mr-1.5 flex-shrink-0 mt-0.5" />
                <span>Scoring: Typically, all selected options must be correct, and no incorrect options chosen, for full credit. Specific scoring rules (like partial credit) are not yet customizable.</span>
            </p>
        </div>
      )}
    </div>
  );

  const showTypeSpecificFields = state.questionType !== QuestionType.OPEN_ENDED;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex items-center justify-center p-4 z-50 transition-opacity duration-300 ease-in-out" role="dialog" aria-modal="true" aria-labelledby="question-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl transform transition-all duration-300 ease-in-out scale-100 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 id="question-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100">Add Question to <span className="text-blue-600 dark:text-blue-400">{groupName}</span></h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close modal">
             <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="questionType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Question Type</label>
            <select
              id="questionType"
              value={state.questionType}
              onChange={(e) => handleQuestionTypeChange(e.target.value as QuestionType)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200"
            >
              <option value={QuestionType.MULTIPLE_CHOICE_SINGLE}>Multiple Choice (Single Answer)</option>
              <option value={QuestionType.MULTIPLE_CHOICE_MULTIPLE}>Multiple Choice (Multiple Answers)</option>
              <option value={QuestionType.TRUE_FALSE}>True/False</option>
              <option value={QuestionType.FILL_IN_THE_BLANK}>Fill-in-the-Blank</option>
              <option value={QuestionType.MATCHING}>Matching</option>
              <option value={QuestionType.DIAGRAM_LABELING}>Diagram Labeling</option>
            </select>
          </div>

          <div className="mb-4">
            <label htmlFor="questionStem" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Question Stem / Title</label>
            <div className="relative">
                <textarea
                id="questionStem"
                value={state.stem}
                onChange={(e) => handleFieldChange('stem', e.target.value)}
                rows={3}
                className="w-full p-2 pr-12 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                placeholder={state.questionType === QuestionType.FILL_IN_THE_BLANK ? "Enter question, use '___' for blanks..." : "Enter the main body of your question..."}
                required
                />
                <VoiceInputButton 
                    className="absolute bottom-2 right-2"
                    onTranscriptUpdate={(text) => handleFieldChange('stem', state.stem + text)}
                />
            </div>
             {state.questionType === QuestionType.FILL_IN_THE_BLANK && !state.stem.includes("___") && state.stem.length > 0 &&
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Remember to use '___' (three underscores) to mark where the blank should be.</p>
            }
          </div>
          
          <div className="mb-4">
            <label htmlFor="questionImage" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attach Image (Optional)</label>
            <div className="mt-1 flex items-center space-x-2">
              <label className="flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer">
                <PhotoIcon className="w-5 h-5 mr-2 text-gray-500 dark:text-gray-400" />
                <span>Choose Image</span>
                <input id="questionImage" name="questionImage" type="file" accept="image/*" onChange={handleImageChange} className="sr-only" />
              </label>
              {state.imagePreviewUrl && state.questionType !== QuestionType.DIAGRAM_LABELING && (
                <div className="relative group">
                  <img src={state.imagePreviewUrl} alt="Preview" className="h-16 w-16 object-cover rounded-md border border-gray-300 dark:border-gray-600" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute -top-2 -right-2 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-red-400"
                    aria-label="Remove image"
                  >
                    <XCircleIcon className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
            {state.selectedImageFile && state.questionType !== QuestionType.DIAGRAM_LABELING && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Selected: {state.selectedImageFile.name}</p>}
          </div>

          <div className="mb-4">
            <label htmlFor="questionTags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center">
              <TagIcon className="w-5 h-5 mr-1 text-gray-500 dark:text-gray-400" />
              Tags (Optional, comma-separated)
            </label>
            <input
              type="text"
              id="questionTags"
              value={state.tagsInput}
              onChange={(e) => handleFieldChange('tagsInput', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              placeholder="e.g., biology, mitosis, chapter3"
            />
          </div>
          
          {showTypeSpecificFields && (
            <div className="my-4 p-3 border-t border-b border-gray-200 dark:border-gray-700">
                <div className="mb-3 p-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-md">
                    <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-start">
                        <InformationCircleIcon className="w-4 h-4 mr-1.5 flex-shrink-0 mt-0.5" />
                        <span>Define correct answers/criteria below. This information will be used to score the question in tests and study mode (where applicable).</span>
                    </p>
                </div>

                {state.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE && renderMCQOptions(false)}
                {state.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE && renderMCQOptions(true)}

                {state.questionType === QuestionType.TRUE_FALSE && (
                    <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correct Answer</label>
                    <div className="flex space-x-4">
                        <label className="flex items-center">
                        <input type="radio" name="trueFalseAnswer" value="true" checked={state.correctAnswerIdsSelected.includes('true')} onChange={() => handleMcqCorrectAnswerChange('true', false)} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-500 focus:ring-blue-500" />
                        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">True</span>
                        </label>
                        <label className="flex items-center">
                        <input type="radio" name="trueFalseAnswer" value="false" checked={state.correctAnswerIdsSelected.includes('false')} onChange={() => handleMcqCorrectAnswerChange('false', false)} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-500 focus:ring-blue-500" />
                        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">False</span>
                        </label>
                    </div>
                    </div>
                )}

                {state.questionType === QuestionType.FILL_IN_THE_BLANK && (
                    <div className="mb-4">
                    <label htmlFor="acceptableAnswers" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Acceptable Answer(s) (comma-separated)</label>
                    <textarea
                        id="acceptableAnswers"
                        value={state.acceptableAnswersInput}
                        onChange={(e) => handleFieldChange('acceptableAnswersInput', e.target.value)}
                        rows={2}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                        placeholder="e.g., Paris, paris"
                        required
                    />
                    </div>
                )}

                {state.questionType === QuestionType.MATCHING && (
                    <div className="mb-4 space-y-4 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/50">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt Items</label>
                        {state.promptItems.map((item, index) => (
                        <div key={item.id} className="flex items-center space-x-2 mb-2">
                            <input type="text" value={item.text} onChange={e => handleMatchingItemTextChange('prompt', item.id, e.target.value)} placeholder={`Prompt ${index + 1}`} className="flex-1 p-2 border border-gray-300 rounded-md shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400" required/>
                            {state.promptItems.length > 1 && <button type="button" onClick={() => handleRemoveMatchingItem('prompt', item.id)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"><TrashIcon className="w-5 h-5"/></button>}
                        </div>
                        ))}
                        <button type="button" onClick={() => handleAddMatchingItem('prompt')} className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"><PlusCircleIcon className="w-5 h-5 mr-1"/>Add Prompt</button>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Answer Items</label>
                        {state.answerItems.map((item, index) => (
                        <div key={item.id} className="flex items-center space-x-2 mb-2">
                            <input type="text" value={item.text} onChange={e => handleMatchingItemTextChange('answer', item.id, e.target.value)} placeholder={`Answer ${index + 1}`} className="flex-1 p-2 border border-gray-300 rounded-md shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400" required/>
                            {state.answerItems.length > 1 && <button type="button" onClick={() => handleRemoveMatchingItem('answer', item.id)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"><TrashIcon className="w-5 h-5"/></button>}
                        </div>
                        ))}
                        <button type="button" onClick={() => handleAddMatchingItem('answer')} className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"><PlusCircleIcon className="w-5 h-5 mr-1"/>Add Answer</button>
                    </div>
                    {state.promptItems.length > 0 && state.answerItems.length > 0 && state.promptItems.some(p => p.text.trim()) && state.answerItems.some(a => a.text.trim()) && (
                        <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Define Correct Matches</label>
                        {state.promptItems.map(promptItem => (
                            <div key={promptItem.id} className="flex items-center space-x-2 mb-2">
                            <span className="w-1/3 truncate text-sm text-gray-600 dark:text-gray-400" title={promptItem.text || `Prompt ${promptItem.id.substring(0,4)}`}>{promptItem.text || `Prompt (empty)`}:</span>
                            <select 
                                value={state.matchSelections[promptItem.id] || ""}
                                onChange={e => handleMatchSelectionChange(promptItem.id, e.target.value)}
                                className="flex-1 p-2 border border-gray-300 rounded-md shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200"
                                required
                            >
                                <option value="">Select matching answer...</option>
                                {state.answerItems.filter(a => a.text.trim()).map(answerItem => (
                                <option key={answerItem.id} value={answerItem.id}>{answerItem.text}</option>
                                ))}
                            </select>
                            </div>
                        ))}
                        </div>
                    )}
                    </div>
                )}
                 {state.questionType === QuestionType.DIAGRAM_LABELING && (
                    <div className="mb-4 space-y-4 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/50">
                        {!state.imagePreviewUrl ? (
                            <p className="text-center text-gray-500 dark:text-gray-400">Please upload an image first to add labels.</p>
                        ) : (
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Click on the image to add a label pin. Drag pins to reposition.</p>
                                <div ref={imageContainerRef} onClick={handleImageClick} className="relative w-full cursor-crosshair border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
                                    <img src={state.imagePreviewUrl} alt="Diagram preview" className="w-full h-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    {state.diagramLabels.map((label, index) => (
                                        <div 
                                            key={label.id}
                                            className="absolute -translate-x-1/2 -translate-y-1/2"
                                            style={{ left: `${label.x}%`, top: `${label.y}%` }}
                                            onMouseDown={(e) => { e.stopPropagation(); setDraggingLabelId(label.id); }}
                                        >
                                            <div className="relative flex items-center justify-center w-6 h-6 bg-red-600 text-white font-bold text-xs rounded-full shadow-lg cursor-move ring-2 ring-white">
                                                {index + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4">
                                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Labels</label>
                                     {state.diagramLabels.map((label, index) => (
                                         <div key={label.id} className="flex items-center space-x-2 mb-2">
                                             <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-red-600 text-white font-bold text-xs rounded-full">{index+1}</span>
                                             <input
                                                 type="text"
                                                 value={label.text}
                                                 onChange={e => dispatch({type: 'UPDATE_DIAGRAM_LABEL_TEXT', id: label.id, text: e.target.value})}
                                                 placeholder={`Label text for pin ${index+1}`}
                                                 className="flex-grow p-2 border border-gray-300 rounded-md shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200"
                                                 required
                                             />
                                             <button type="button" onClick={() => dispatch({type: 'REMOVE_DIAGRAM_LABEL', id: label.id})} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"><TrashIcon className="w-5 h-5"/></button>
                                         </div>
                                     ))}
                                </div>
                            </div>
                        )}
                    </div>
                 )}
            </div>
          )}


          <div className="mb-6">
            <label htmlFor="explanation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Explanation</label>
            <div className="relative">
                <textarea
                id="explanation"
                value={state.explanation}
                onChange={(e) => handleFieldChange('explanation', e.target.value)}
                rows={3}
                className="w-full p-2 pr-12 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm bg-white dark:bg-gray-700 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                placeholder="Provide a detailed explanation for the answer(s)..."
                required
                />
                <VoiceInputButton 
                    className="absolute bottom-2 right-2"
                    onTranscriptUpdate={(text) => handleFieldChange('explanation', state.explanation + text)}
                />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 dark:focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-50"
              disabled={!isFormValid() || isSubmitting}
            >
              {isSubmitting && <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />}
              {isSubmitting ? 'Submitting...' : 'Submit Question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default QuestionModal;