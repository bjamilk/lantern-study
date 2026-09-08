// ===========================================
// Lantern Study Mobile - Question Modal
// ===========================================

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPOSER_KEYBOARD_BEHAVIOR } from './chat/composerKeyboardBehavior';
import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActionSheetIOS,
} from 'react-native';
import { appAlert } from './ui/appDialog';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, ThemeScope } from '../theme';
import { AppIcon, type AppIconName } from './ui/AppIcon';

export type QuestionType = 
  | 'mcq-single'
  | 'mcq-multiple'
  | 'true-false'
  | 'fill-blank'
  | 'matching'
  | 'diagram-labelling';

interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
  imageUri?: string;
}

interface MatchingPair {
  id: string;
  left: string;
  right: string;
  leftImageUri?: string;
  rightImageUri?: string;
}

interface DiagramLabel {
  id: string;
  labelNumber: string;
  correctAnswer: string;
}

interface QuestionImage {
  uri: string;
  width?: number;
  height?: number;
}

interface Question {
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  correctAnswer?: string;
  explanation?: string;
  tags: string[];
  matchingPairs?: MatchingPair[];
  diagramLabels?: DiagramLabel[];
  diagramUrl?: string;
  questionImage?: QuestionImage;
  diagramImage?: QuestionImage;
}

interface QuestionModalProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  onSubmit: (question: Question) => void | Promise<void>;
}

const QUESTION_TYPES: { type: QuestionType; label: string; icon: AppIconName }[] = [
  { type: 'mcq-single', label: 'Single Choice', icon: 'radio-button-on' },
  { type: 'mcq-multiple', label: 'Multiple Choice', icon: 'checkbox' },
  { type: 'true-false', label: 'True/False', icon: 'swap-horizontal' },
  { type: 'fill-blank', label: 'Fill in Blank', icon: 'text' },
  { type: 'matching', label: 'Matching', icon: 'git-compare' },
  { type: 'diagram-labelling', label: 'Diagram Labelling', icon: 'image' },
];

export default function QuestionModal({
  visible,
  onClose,
  groupId,
  onSubmit,
}: QuestionModalProps) {
  const [step, setStep] = useState<'type' | 'content' | 'options'>('type');
  const insets = useSafeAreaInsets();
  const [questionType, setQuestionType] = useState<QuestionType>('mcq-single');
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState<QuestionOption[]>([
    { id: '1', text: '', isCorrect: false },
    { id: '2', text: '', isCorrect: false },
    { id: '3', text: '', isCorrect: false },
    { id: '4', text: '', isCorrect: false },
  ]);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [tags, setTags] = useState('');
  const [matchingPairs, setMatchingPairs] = useState<MatchingPair[]>([
    { id: '1', left: '', right: '' },
    { id: '2', left: '', right: '' },
    { id: '3', left: '', right: '' },
  ]);
  const [diagramLabels, setDiagramLabels] = useState<DiagramLabel[]>([
    { id: '1', labelNumber: '1', correctAnswer: '' },
    { id: '2', labelNumber: '2', correctAnswer: '' },
    { id: '3', labelNumber: '3', correctAnswer: '' },
  ]);
  const [diagramDescription, setDiagramDescription] = useState('');
  const [questionImage, setQuestionImage] = useState<QuestionImage | null>(null);
  const [diagramImage, setDiagramImage] = useState<QuestionImage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { colors, isDark } = useTheme();

  const themed = useMemo(
    () => ({
      input: {
        backgroundColor: colors.inputBackground,
        borderColor: colors.border,
        color: colors.text,
      },
      label: { color: colors.text },
      hint: { color: colors.textSecondary },
      imageUpload: {
        backgroundColor: colors.inputBackground,
        borderColor: colors.primary,
      },
      matchingArrow: { backgroundColor: `${colors.primary}20` },
      diagramPreview: { backgroundColor: colors.inputBackground },
      addOption: { borderColor: colors.primary },
      progressTrack: { backgroundColor: colors.border },
    }),
    [colors]
  );

  // Image picker function
  const pickImage = async (
    target: 'question' | 'diagram' | 'option' | 'matching-left' | 'matching-right',
    optionId?: string
  ) => {
    const showOptions = () => {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'Take Photo', 'Choose from Library'],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await launchCamera(target, optionId);
            } else if (buttonIndex === 2) {
              await launchLibrary(target, optionId);
            }
          }
        );
      } else {
        appAlert(
          'Add Image',
          'Choose an option',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Take Photo', onPress: () => launchCamera(target, optionId) },
            { text: 'Choose from Library', onPress: () => launchLibrary(target, optionId) },
          ]
        );
      }
    };

    showOptions();
  };

  const launchCamera = async (
    target: 'question' | 'diagram' | 'option' | 'matching-left' | 'matching-right',
    optionId?: string
  ) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      appAlert('Permission Required', 'Camera permission is needed to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      exif: false,
    });

    if (!result.canceled && result.assets[0]) {
      await handleImageResult(result.assets[0], target, optionId);
    }
  };

  const launchLibrary = async (
    target: 'question' | 'diagram' | 'option' | 'matching-left' | 'matching-right',
    optionId?: string
  ) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      appAlert('Permission Required', 'Photo library permission is needed to select images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      exif: false,
    });

    if (!result.canceled && result.assets[0]) {
      await handleImageResult(result.assets[0], target, optionId);
    }
  };

  const handleImageResult = async (
    asset: ImagePicker.ImagePickerAsset,
    target: 'question' | 'diagram' | 'option' | 'matching-left' | 'matching-right',
    optionId?: string
  ) => {
    const { prepareImageForUpload } = await import('../utils/prepareImage');
    const prepared = await prepareImageForUpload(asset.uri, 'question', {
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });
    const imageData: QuestionImage = {
      uri: prepared.uri,
      width: prepared.width ?? asset.width,
      height: prepared.height ?? asset.height,
    };

    switch (target) {
      case 'question':
        setQuestionImage(imageData);
        break;
      case 'diagram':
        setDiagramImage(imageData);
        break;
      case 'option':
        if (optionId) {
          setOptions(options.map(o => 
            o.id === optionId ? { ...o, imageUri: asset.uri } : o
          ));
        }
        break;
      case 'matching-left':
        if (optionId) {
          setMatchingPairs(matchingPairs.map(p => 
            p.id === optionId ? { ...p, leftImageUri: asset.uri } : p
          ));
        }
        break;
      case 'matching-right':
        if (optionId) {
          setMatchingPairs(matchingPairs.map(p => 
            p.id === optionId ? { ...p, rightImageUri: asset.uri } : p
          ));
        }
        break;
    }
  };

  const removeImage = (
    target: 'question' | 'diagram' | 'option' | 'matching-left' | 'matching-right',
    optionId?: string
  ) => {
    switch (target) {
      case 'question':
        setQuestionImage(null);
        break;
      case 'diagram':
        setDiagramImage(null);
        break;
      case 'option':
        if (optionId) {
          setOptions(options.map(o => 
            o.id === optionId ? { ...o, imageUri: undefined } : o
          ));
        }
        break;
      case 'matching-left':
        if (optionId) {
          setMatchingPairs(matchingPairs.map(p => 
            p.id === optionId ? { ...p, leftImageUri: undefined } : p
          ));
        }
        break;
      case 'matching-right':
        if (optionId) {
          setMatchingPairs(matchingPairs.map(p => 
            p.id === optionId ? { ...p, rightImageUri: undefined } : p
          ));
        }
        break;
    }
  };

  const resetForm = () => {
    setStep('type');
    setQuestionType('mcq-single');
    setStem('');
    setOptions([
      { id: '1', text: '', isCorrect: false },
      { id: '2', text: '', isCorrect: false },
      { id: '3', text: '', isCorrect: false },
      { id: '4', text: '', isCorrect: false },
    ]);
    setCorrectAnswer('');
    setExplanation('');
    setTags('');
    setMatchingPairs([
      { id: '1', left: '', right: '' },
      { id: '2', left: '', right: '' },
      { id: '3', left: '', right: '' },
    ]);
    setDiagramLabels([
      { id: '1', labelNumber: '1', correctAnswer: '' },
      { id: '2', labelNumber: '2', correctAnswer: '' },
      { id: '3', labelNumber: '3', correctAnswer: '' },
    ]);
    setDiagramDescription('');
    setQuestionImage(null);
    setDiagramImage(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSelectType = (type: QuestionType) => {
    setQuestionType(type);
    
    // Initialize appropriate options based on type
    if (type === 'true-false') {
      setOptions([
        { id: '1', text: 'True', isCorrect: false },
        { id: '2', text: 'False', isCorrect: false },
      ]);
    } else if (type === 'fill-blank' || type === 'matching' || type === 'diagram-labelling') {
      setOptions([]);
    } else {
      setOptions([
        { id: '1', text: '', isCorrect: false },
        { id: '2', text: '', isCorrect: false },
        { id: '3', text: '', isCorrect: false },
        { id: '4', text: '', isCorrect: false },
      ]);
    }
    
    setStep('content');
  };

  // Matching pairs handlers
  const handleAddMatchingPair = () => {
    if (matchingPairs.length < 8) {
      setMatchingPairs([
        ...matchingPairs,
        { id: String(Date.now()), left: '', right: '' },
      ]);
    }
  };

  const handleRemoveMatchingPair = (id: string) => {
    if (matchingPairs.length > 2) {
      setMatchingPairs(matchingPairs.filter(p => p.id !== id));
    }
  };

  const handleMatchingPairChange = (id: string, field: 'left' | 'right', value: string) => {
    setMatchingPairs(matchingPairs.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  // Diagram labels handlers
  const handleAddDiagramLabel = () => {
    if (diagramLabels.length < 10) {
      const nextNumber = String(diagramLabels.length + 1);
      setDiagramLabels([
        ...diagramLabels,
        { id: String(Date.now()), labelNumber: nextNumber, correctAnswer: '' },
      ]);
    }
  };

  const handleRemoveDiagramLabel = (id: string) => {
    if (diagramLabels.length > 2) {
      const filtered = diagramLabels.filter(l => l.id !== id);
      // Renumber labels
      const renumbered = filtered.map((l, idx) => ({
        ...l,
        labelNumber: String(idx + 1),
      }));
      setDiagramLabels(renumbered);
    }
  };

  const handleDiagramLabelChange = (id: string, value: string) => {
    setDiagramLabels(diagramLabels.map(l => 
      l.id === id ? { ...l, correctAnswer: value } : l
    ));
  };

  const handleAddOption = () => {
    if (options.length < 8) {
      setOptions([
        ...options,
        { id: String(Date.now()), text: '', isCorrect: false },
      ]);
    }
  };

  const handleRemoveOption = (id: string) => {
    if (options.length > 2) {
      setOptions(options.filter(o => o.id !== id));
    }
  };

  const handleOptionChange = (id: string, text: string) => {
    setOptions(options.map(o => o.id === id ? { ...o, text } : o));
  };

  const handleCorrectToggle = (id: string) => {
    if (questionType === 'mcq-single' || questionType === 'true-false') {
      // Only one correct answer
      setOptions(options.map(o => ({ ...o, isCorrect: o.id === id })));
    } else {
      // Multiple correct answers
      setOptions(options.map(o => 
        o.id === id ? { ...o, isCorrect: !o.isCorrect } : o
      ));
    }
  };

  const validateAndSubmit = () => {
    // Validate stem
    if (!stem.trim()) {
      appAlert('Error', 'Please enter a question');
      return;
    }

    // Validate options for MCQ types
    if (['mcq-single', 'mcq-multiple', 'true-false'].includes(questionType)) {
      const filledOptions = options.filter(o => o.text.trim());
      if (filledOptions.length < 2) {
        appAlert('Error', 'Please add at least 2 answer options');
        return;
      }

      const hasCorrect = options.some(o => o.isCorrect);
      if (!hasCorrect) {
        appAlert('Error', 'Please mark at least one correct answer');
        return;
      }
    }

    // Validate fill in blank
    if (questionType === 'fill-blank' && !correctAnswer.trim()) {
      appAlert('Error', 'Please provide the correct answer');
      return;
    }

    // Validate matching pairs
    if (questionType === 'matching') {
      const filledPairs = matchingPairs.filter(p => p.left.trim() && p.right.trim());
      if (filledPairs.length < 2) {
        appAlert('Error', 'Please add at least 2 complete matching pairs');
        return;
      }
    }

    // Validate diagram labels
    if (questionType === 'diagram-labelling') {
      if (!diagramImage) {
        appAlert('Error', 'Please upload a diagram image');
        return;
      }
      const filledLabels = diagramLabels.filter(l => l.correctAnswer.trim());
      if (filledLabels.length < 2) {
        appAlert('Error', 'Please add at least 2 labels with answers');
        return;
      }
    }

    // Parse tags
    const tagList = tags
      .split(/[,;]/)
      .map(t => t.trim())
      .filter(t => t);

    const question: Question = {
      type: questionType,
      stem: stem.trim(),
      options: options.filter(o => o.text.trim()),
      correctAnswer: questionType === 'fill-blank' ? correctAnswer : undefined,
      explanation: explanation.trim() || undefined,
      tags: tagList,
      matchingPairs: questionType === 'matching' 
        ? matchingPairs.filter(p => p.left.trim() && p.right.trim())
        : undefined,
      diagramLabels: questionType === 'diagram-labelling'
        ? diagramLabels.filter(l => l.correctAnswer.trim())
        : undefined,
      questionImage: questionImage || undefined,
      diagramImage: diagramImage || undefined,
    };

    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    void (async () => {
      try {
        await onSubmit(question);
        handleClose();
        appAlert('Success', 'Question submitted successfully!');
      } catch (error: any) {
        appAlert('Error', error?.message || 'Failed to submit question.');
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    })();
  };

  const renderTypeSelection = () => (
    <ScrollView 
      style={styles.stepContent} 
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.typeSelectionContent}
    >
      <Text style={[styles.stepTitle, { color: colors.text }]}>Choose Question Type</Text>
      <Text style={[styles.stepDescription, { color: colors.textSecondary }]}>
        Select the format for your question
      </Text>

      <View style={styles.typeGrid}>
        {QUESTION_TYPES.map(({ type, label, icon }) => (
          <TouchableOpacity
            key={type}
            style={[
              styles.typeCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              questionType === type && { borderColor: colors.primary, backgroundColor: colors.card },
            ]}
            onPress={() => handleSelectType(type)}
          >
            <View style={[
              styles.typeIcon,
              { backgroundColor: colors.inputBackground },
              questionType === type && { backgroundColor: colors.primaryFill },
            ]}>
              <AppIcon 
                name={icon} 
                size={28} 
                color={questionType === type ? '#ffffff' : colors.primary} 
              />
            </View>
            <Text style={[
              styles.typeLabel,
              { color: colors.textSecondary },
              questionType === type && { color: colors.text },
            ]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderContentForm = () => (
    <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.stepTitle, { color: colors.text }]}>Enter Question Details</Text>

      {/* Question Stem */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, themed.label]}>Question *</Text>
        <TextInput
          style={[styles.input, styles.textArea, themed.input]}
          placeholder="Enter your question here..."
          placeholderTextColor={colors.inputPlaceholder}
          value={stem}
          onChangeText={setStem}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        {questionType === 'fill-blank' && (
          <Text style={[styles.inputHint, themed.hint]}>
            Use _____ (underscores) to indicate the blank
          </Text>
        )}
      </View>

      {/* Question Image Upload */}
      {questionType !== 'diagram-labelling' && (
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, themed.label]}>Question Image (Optional)</Text>
          {questionImage ? (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: questionImage.uri }} style={styles.imagePreview} />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={() => removeImage('question')}
              >
                <AppIcon name="close-circle" size={28} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.imageUploadButton, themed.imageUpload]}
              onPress={() => pickImage('question')}
            >
              <AppIcon name="camera" size={24} color={colors.primaryText} />
              <Text style={[styles.imageUploadText, { color: colors.primaryText }]}>Add Image</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Answer Options for MCQ */}
      {['mcq-single', 'mcq-multiple', 'true-false'].includes(questionType) && (
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, themed.label]}>Answer Options *</Text>
          <Text style={[styles.inputHint, themed.hint]}>
            {questionType === 'mcq-single' || questionType === 'true-false'
              ? 'Tap the circle to mark the correct answer'
              : 'Tap circles to mark all correct answers'}
          </Text>

          {options.map((option, index) => (
            <View key={option.id}>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  style={[
                    styles.correctToggle,
                    option.isCorrect && styles.correctToggleActive,
                  ]}
                  onPress={() => handleCorrectToggle(option.id)}
                >
                  <AppIcon
                    name={option.isCorrect ? 'checkmark-circle' : 'ellipse'}
                    size={24}
                    color={option.isCorrect ? colors.success : colors.textSecondary}
                  />
                </TouchableOpacity>
                <TextInput
                  style={[styles.optionInput, themed.input]}
                  placeholder={`Option ${index + 1}`}
                  placeholderTextColor={colors.inputPlaceholder}
                  value={option.text}
                  onChangeText={(text) => handleOptionChange(option.id, text)}
                  editable={questionType !== 'true-false'}
                />
                {questionType !== 'true-false' && (
                  <TouchableOpacity
                    style={styles.removeOption}
                    onPress={() => pickImage('option', option.id)}
                  >
                    <AppIcon name="camera" size={20} color={colors.primaryText} />
                  </TouchableOpacity>
                )}
                {questionType !== 'true-false' && options.length > 2 && (
                  <TouchableOpacity
                    style={styles.removeOption}
                    onPress={() => handleRemoveOption(option.id)}
                  >
                    <AppIcon name="close-circle" size={22} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
              {option.imageUri && (
                <View style={styles.optionImageContainer}>
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: option.imageUri }} style={styles.optionImagePreview} />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => removeImage('option', option.id)}
                    >
                      <AppIcon name="close-circle" size={24} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}

          {questionType !== 'true-false' && options.length < 8 && (
            <TouchableOpacity style={[styles.addOptionButton, themed.addOption]} onPress={handleAddOption}>
              <AppIcon name="add-circle" size={20} color={colors.primaryText} />
              <Text style={[styles.addOptionText, { color: colors.primaryText }]}>Add Option</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Correct Answer for Fill in Blank */}
      {questionType === 'fill-blank' && (
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, themed.label]}>Correct Answer *</Text>
          <TextInput
            style={[styles.input, themed.input]}
            placeholder="Enter the correct answer"
            placeholderTextColor={colors.inputPlaceholder}
            value={correctAnswer}
            onChangeText={setCorrectAnswer}
          />
        </View>
      )}

      {/* Matching Pairs */}
      {questionType === 'matching' && (
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, themed.label]}>Matching Pairs *</Text>
          <Text style={[styles.inputHint, themed.hint]}>
            Enter items that should be matched together
          </Text>

          {matchingPairs.map((pair, index) => (
            <View key={pair.id} style={styles.matchingRow}>
              <View style={styles.matchingInputs}>
                <TextInput
                  style={[styles.matchingInput, themed.input]}
                  placeholder={`Item ${index + 1}`}
                  placeholderTextColor={colors.inputPlaceholder}
                  value={pair.left}
                  onChangeText={(text) => handleMatchingPairChange(pair.id, 'left', text)}
                />
                <View style={[styles.matchingArrow, themed.matchingArrow]}>
                  <AppIcon name="arrow-forward" size={18} color={colors.primaryText} />
                </View>
                <TextInput
                  style={[styles.matchingInput, themed.input]}
                  placeholder={`Match ${index + 1}`}
                  placeholderTextColor={colors.inputPlaceholder}
                  value={pair.right}
                  onChangeText={(text) => handleMatchingPairChange(pair.id, 'right', text)}
                />
              </View>
              {matchingPairs.length > 2 && (
                <TouchableOpacity
                  style={styles.removeOption}
                  onPress={() => handleRemoveMatchingPair(pair.id)}
                >
                  <AppIcon name="close-circle" size={22} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {matchingPairs.length < 8 && (
            <TouchableOpacity style={[styles.addOptionButton, themed.addOption]} onPress={handleAddMatchingPair}>
              <AppIcon name="add-circle" size={20} color={colors.primaryText} />
              <Text style={[styles.addOptionText, { color: colors.primaryText }]}>Add Pair</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Diagram Labelling */}
      {questionType === 'diagram-labelling' && (
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, themed.label]}>Diagram Image *</Text>
          <Text style={[styles.inputHint, themed.hint]}>
            Upload the diagram image that students will label
          </Text>
          
          {diagramImage ? (
            <View style={[styles.imagePreviewContainer, styles.diagramImageContainer]}>
              <Image
                source={{ uri: diagramImage.uri }}
                style={[styles.diagramImagePreview, themed.diagramPreview]}
              />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={() => removeImage('diagram')}
              >
                <AppIcon name="close-circle" size={28} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.imageUploadButton, themed.imageUpload]}
              onPress={() => pickImage('diagram')}
            >
              <AppIcon name="image" size={32} color={colors.primaryText} />
              <Text style={[styles.imageUploadText, { color: colors.primaryText }]}>Upload Diagram</Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.inputLabel, themed.label, { marginTop: 20 }]}>Labels *</Text>
          <Text style={[styles.inputHint, themed.hint]}>
            Enter the correct answer for each numbered label on the diagram
          </Text>

          {diagramLabels.map((label) => (
            <View key={label.id} style={styles.diagramLabelRow}>
              <View style={[styles.labelNumber, { backgroundColor: colors.primaryFill }]}>
                <Text style={styles.labelNumberText}>{label.labelNumber}</Text>
              </View>
              <TextInput
                style={[styles.labelInput, themed.input]}
                placeholder={`Answer for label ${label.labelNumber}`}
                placeholderTextColor={colors.inputPlaceholder}
                value={label.correctAnswer}
                onChangeText={(text) => handleDiagramLabelChange(label.id, text)}
              />
              {diagramLabels.length > 2 && (
                <TouchableOpacity
                  style={styles.removeOption}
                  onPress={() => handleRemoveDiagramLabel(label.id)}
                >
                  <AppIcon name="close-circle" size={22} color={colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {diagramLabels.length < 10 && (
            <TouchableOpacity style={[styles.addOptionButton, themed.addOption]} onPress={handleAddDiagramLabel}>
              <AppIcon name="add-circle" size={20} color={colors.primaryText} />
              <Text style={[styles.addOptionText, { color: colors.primaryText }]}>Add Label</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Explanation */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, themed.label]}>Explanation (Optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea, themed.input]}
          placeholder="Why is this the correct answer?"
          placeholderTextColor={colors.inputPlaceholder}
          value={explanation}
          onChangeText={setExplanation}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {/* Tags */}
      <View style={styles.inputGroup}>
        <Text style={[styles.inputLabel, themed.label]}>Tags (Optional)</Text>
        <TextInput
          style={[styles.input, themed.input]}
          placeholder="e.g. Biology, Genetics, Chapter 5"
          placeholderTextColor={colors.inputPlaceholder}
          value={tags}
          onChangeText={setTags}
        />
        <Text style={[styles.inputHint, themed.hint]}>Separate tags with commas</Text>
      </View>

      {/* Submit Button */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          { backgroundColor: colors.success },
          isSubmitting && { opacity: 0.6 },
        ]}
        onPress={validateAndSubmit}
        disabled={isSubmitting}
      >
        <AppIcon name="send" size={20} color="#ffffff" />
        <Text style={styles.submitButtonText}>
          {isSubmitting ? 'Submitting...' : 'Submit Question'}
        </Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <ThemeScope
        style={[
          styles.overlay,
          { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.45)' },
        ]}
      >
        <KeyboardAvoidingView
          behavior={COMPOSER_KEYBOARD_BEHAVIOR}
          style={styles.overlayContent}
        >
          <View style={[styles.container, { paddingBottom: insets.bottom + 12, backgroundColor: colors.card }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={styles.headerLeft}>
                {step !== 'type' && (
                  <TouchableOpacity
                    style={[styles.backButton, { backgroundColor: colors.background }]}
                    onPress={() => setStep('type')}
                  >
                    <AppIcon name="arrow-back" size={24} color={colors.text} />
                  </TouchableOpacity>
                )}
                <Text style={[styles.title, { color: colors.text }]}>Submit Question</Text>
              </View>
              <TouchableOpacity style={[styles.closeButton, { backgroundColor: colors.background }]} onPress={handleClose}>
                <AppIcon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Progress Indicator */}
            <View style={[styles.progressBar, themed.progressTrack]}>
              <View style={[
                styles.progressFill,
                { width: step === 'type' ? '50%' : '100%', backgroundColor: colors.primaryFill },
              ]} />
            </View>

            {/* Content */}
            {step === 'type' && renderTypeSelection()}
            {step === 'content' && renderContentForm()}
          </View>
        </KeyboardAvoidingView>
      </ThemeScope>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayContent: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    height: 4,
    marginHorizontal: 20,
    borderRadius: 2,
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  stepContent: {
    flex: 1,
    padding: 20,
  },
  typeSelectionContent: {
    paddingBottom: 20,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    marginBottom: 24,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  typeCard: {
    width: '48%',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeCardSelected: {
    borderColor: '#6366f1',
  },
  typeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeIconSelected: {
    backgroundColor: '#6366f1',
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  typeLabelSelected: {
    color: '#6366f1',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 6,
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  correctToggle: {
    padding: 4,
  },
  correctToggleActive: {},
  optionInput: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  removeOption: {
    padding: 4,
  },
  addOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    marginTop: 4,
  },
  addOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  matchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  matchingInputs: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchingInput: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  matchingArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagramLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  labelNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelNumberText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  labelInput: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 10,
    marginTop: 10,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  // Image upload styles
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 14,
  },
  imageUploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
  },
  imageUploadText: {
    fontSize: 16,
    fontWeight: '500',
  },
  optionImageContainer: {
    marginTop: 8,
    marginLeft: 36,
  },
  optionImagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  optionImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1e293b80',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignSelf: 'flex-start',
  },
  optionImageButtonText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  diagramImageContainer: {
    marginBottom: 16,
  },
  diagramImagePreview: {
    width: '100%',
    height: 250,
    borderRadius: 12,
    resizeMode: 'contain',
  },
  matchingImagePreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  matchingImageButton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
