import React from 'react';

// Web renderer uses react-markdown + KaTeX
// Mobile renderer uses React Native Text (required — raw strings cannot live inside View)

export interface MarkdownRendererProps {
  content?: string;
  className?: string;
  style?: Record<string, unknown>;
  /** When false, skip remark-math / rehype-katex (legal docs, plain prose). Default true. */
  enableMath?: boolean;
}

function isReactNativeRuntime(): boolean {
  try {
    const { Platform } = require('react-native');
    return !!Platform?.OS;
  } catch {
    return false;
  }
}

function getMobileTextComponent(): React.ComponentType<any> | null {
  try {
    return require('react-native').Text;
  } catch {
    return null;
  }
}

const isWeb = !isReactNativeRuntime();

type WebMarkdownDeps = {
  ReactMarkdown: any;
  remarkMath: any;
  remarkGfm: any;
  rehypeKatex: any;
  rehypeSanitize: any;
};

const useWebMarkdownDeps = (enableMath: boolean) => {
  const [deps, setDeps] = React.useState<WebMarkdownDeps | null>(null);

  React.useEffect(() => {
    if (!isWeb) return;

    let isMounted = true;

    (async () => {
      try {
        const imports: Promise<any>[] = [
          import('react-markdown'),
          import('remark-gfm'),
          import('rehype-sanitize'),
        ];
        if (enableMath) {
          imports.push(
            import('remark-math'),
            import('rehype-katex'),
            // @ts-ignore: CSS imports are handled by Vite
            import('katex/dist/katex.min.css').catch(() => null),
          );
        }

        const modules = await Promise.all(imports);
        const [{ default: ReactMarkdown }, remarkGfm, rehypeSanitize] = modules;
        const remarkMath = enableMath ? modules[3] : null;
        const rehypeKatex = enableMath ? modules[4] : null;

        const normalizePkg = (mod: any) => (mod ? (mod.default ?? mod) : null);
        const gfmPlugin = normalizePkg(remarkGfm);
        const sanitizePlugin = normalizePkg(rehypeSanitize);
        const mathPlugin = enableMath ? normalizePkg(remarkMath) : null;
        const katexPlugin = enableMath ? normalizePkg(rehypeKatex) : null;

        if (!isMounted) return;

        if (!gfmPlugin || !sanitizePlugin || (enableMath && (!mathPlugin || !katexPlugin))) {
          setDeps(null);
          return;
        }

        setDeps({
          ReactMarkdown,
          remarkMath: mathPlugin,
          remarkGfm: gfmPlugin,
          rehypeKatex: katexPlugin,
          rehypeSanitize: sanitizePlugin,
        });
      } catch {
        if (isMounted) setDeps(null);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [enableMath]);

  return deps;
};

const MobileMarkdownText: React.FC<{ content: string; style?: Record<string, unknown> }> = ({ content, style }) => {
  const Text = getMobileTextComponent();
  if (!Text) return null;

  const segments: Array<{ type: 'text' | 'math'; value: string }> = [];
  const regex = /\$(.+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content))) {
    const [full, expr] = match;
    const index = match.index;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, index) });
    }
    segments.push({ type: 'math', value: expr ?? '' });
    lastIndex = index + full.length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return <Text style={style}>{content}</Text>;
  }

  return (
    <Text style={style}>
      {segments.map((segment, idx) => (
        <Text
          key={idx}
          style={segment.type === 'math' ? { fontStyle: 'italic' } : undefined}
        >
          {segment.type === 'math' ? `$${segment.value}$` : segment.value}
        </Text>
      ))}
    </Text>
  );
};

class MarkdownRenderErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[MarkdownRenderer] render failed, falling back to plain text', error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  style,
  enableMath = true,
}) => {
  const safeContent = content ?? '';
  const deps = useWebMarkdownDeps(enableMath);

  const plainFallback = (
    <pre className={className} style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
      {safeContent}
    </pre>
  );

  if (!isWeb) {
    return <MobileMarkdownText content={safeContent} style={style} />;
  }

  if (!deps) {
    return plainFallback;
  }

  const { ReactMarkdown, remarkMath, remarkGfm, rehypeKatex, rehypeSanitize } = deps;
  const remarkPlugins = enableMath && remarkMath ? [remarkMath, remarkGfm] : [remarkGfm];
  const rehypePlugins =
    enableMath && rehypeKatex ? [rehypeSanitize, rehypeKatex] : [rehypeSanitize];

  return (
    <MarkdownRenderErrorBoundary fallback={plainFallback}>
      <div className={className}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={{
            a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {safeContent}
        </ReactMarkdown>
      </div>
    </MarkdownRenderErrorBoundary>
  );
};
