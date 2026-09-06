// ===========================================
// Lantern Study Mobile - Themed Components
// Reusable components with proper theme support
// ===========================================

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  TextInputProps,
  TouchableOpacityProps,
} from 'react-native';
import { SafeAreaView, SafeAreaViewProps } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

// ===========================================
// Screen Container - wraps screens with theme background
// ===========================================
interface ScreenContainerProps extends SafeAreaViewProps {
  children: React.ReactNode;
}

export const ScreenContainer: React.FC<ScreenContainerProps> = ({ 
  children, 
  style,
  ...props 
}) => {
  const { colors } = useTheme();
  
  return (
    <SafeAreaView 
      style={[{ flex: 1, backgroundColor: colors.background }, style]} 
      {...props}
    >
      {children}
    </SafeAreaView>
  );
};

// ===========================================
// Themed Card - card container with theme colors
// ===========================================
interface ThemedCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'primary' | 'secondary';
}

export const ThemedCard: React.FC<ThemedCardProps> = ({ 
  children, 
  style,
  variant = 'primary',
}) => {
  const { colors } = useTheme();
  
  return (
    <View 
      style={[
        styles.card,
        { 
          backgroundColor: variant === 'primary' ? colors.card : colors.cardSecondary,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

// ===========================================
// Themed Text - text with proper theme colors
// ===========================================
interface ThemedTextProps {
  children: React.ReactNode;
  style?: TextStyle;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'inverse';
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
}

const textSizes = {
  xs: 10,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 18,
  '2xl': 24,
  '3xl': 32,
};

const textWeights: Record<string, TextStyle['fontWeight']> = {
  normal: 'normal',
  medium: '500',
  semibold: '600',
  bold: 'bold',
};

export const ThemedText: React.FC<ThemedTextProps> = ({ 
  children, 
  style,
  variant = 'primary',
  size = 'base',
  weight = 'normal',
}) => {
  const { colors } = useTheme();
  
  const colorMap = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    inverse: colors.textInverse,
  };
  
  return (
    <Text 
      style={[
        { 
          color: colorMap[variant],
          fontSize: textSizes[size],
          fontWeight: textWeights[weight],
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
};

// ===========================================
// Themed Input - TextInput with theme colors
// ===========================================
interface ThemedInputProps extends TextInputProps {
  containerStyle?: ViewStyle;
  hasError?: boolean;
}

export const ThemedInput: React.FC<ThemedInputProps> = ({ 
  style,
  containerStyle,
  hasError,
  ...props 
}) => {
  const { colors } = useTheme();
  
  return (
    <View 
      style={[
        styles.inputContainer,
        { 
          backgroundColor: colors.inputBackground,
          borderColor: hasError ? colors.error : colors.inputBorder,
        },
        containerStyle,
      ]}
    >
      <TextInput
        style={[
          styles.input,
          { color: colors.inputText },
          style,
        ]}
        placeholderTextColor={colors.inputPlaceholder}
        {...props}
      />
    </View>
  );
};

// ===========================================
// Themed Button - Button with theme colors
// ===========================================
interface ThemedButtonProps extends TouchableOpacityProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const ThemedButton: React.FC<ThemedButtonProps> = ({ 
  children,
  style,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled,
  ...props 
}) => {
  const { colors } = useTheme();
  
  const getButtonStyles = (): ViewStyle => {
    const baseStyles: ViewStyle = {
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.6 : 1,
    };
    
    // Size styles
    const sizeStyles: Record<string, ViewStyle> = {
      sm: { paddingVertical: 8, paddingHorizontal: 16 },
      md: { paddingVertical: 12, paddingHorizontal: 20 },
      lg: { paddingVertical: 16, paddingHorizontal: 24, height: 52 },
    };
    
    // Variant styles
    const variantStyles: Record<string, ViewStyle> = {
      primary: { backgroundColor: colors.primaryFill },
      secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
      ghost: { backgroundColor: 'transparent' },
      danger: { backgroundColor: colors.error },
    };
    
    return {
      ...baseStyles,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...(fullWidth && { width: '100%' }),
    };
  };
  
  const getTextColor = (): string => {
    switch (variant) {
      case 'primary':
      case 'danger':
        return colors.textInverse;
      case 'secondary':
        return colors.text;
      case 'ghost':
        return colors.primary;
      default:
        return colors.text;
    }
  };
  
  return (
    <TouchableOpacity
      style={[getButtonStyles(), style]}
      disabled={disabled}
      activeOpacity={0.8}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text style={{ color: getTextColor(), fontWeight: '600', fontSize: size === 'lg' ? 16 : 14 }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
};

// ===========================================
// Themed Divider
// ===========================================
interface ThemedDividerProps {
  style?: ViewStyle;
}

export const ThemedDivider: React.FC<ThemedDividerProps> = ({ style }) => {
  const { colors } = useTheme();
  
  return (
    <View 
      style={[
        { height: 1, backgroundColor: colors.border },
        style,
      ]} 
    />
  );
};

// ===========================================
// Modal Container - for modal backgrounds
// ===========================================
interface ModalContainerProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const ModalContainer: React.FC<ModalContainerProps> = ({ 
  children, 
  style,
}) => {
  const { colors } = useTheme();
  
  return (
    <View 
      style={[
        styles.modalContainer,
        { backgroundColor: colors.background },
        style,
      ]}
    >
      {children}
    </View>
  );
};

// ===========================================
// Section Header
// ===========================================
interface SectionHeaderProps {
  title: string;
  style?: TextStyle;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ 
  title, 
  style,
}) => {
  const { colors } = useTheme();
  
  return (
    <Text 
      style={[
        styles.sectionHeader,
        { color: colors.textTertiary },
        style,
      ]}
    >
      {title}
    </Text>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  inputContainer: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  input: {
    height: 52,
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginTop: 24,
  },
});
