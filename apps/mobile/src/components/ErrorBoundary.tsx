import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View className="rounded-xl border border-lantern-border bg-lantern-surface p-4 items-center">
          <Text className="text-base font-semibold text-lantern-text mb-2">
            {this.props.fallbackTitle || 'Something went wrong'}
          </Text>
          <Text className="text-sm text-lantern-text-secondary text-center mb-4">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <Pressable
            onPress={this.handleRetry}
            className="px-4 py-2 rounded-lg bg-lantern-primary-fill"
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text className="text-sm font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
