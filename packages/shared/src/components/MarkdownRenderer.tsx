import React from 'react';

// Web renderer uses react-markdown + KaTeX
// Mobile renderer uses React Native Text (required — raw strings cannot live inside View)

export interface MarkdownRendererProps {
  content?: string;
  className?: string;
  style?: Record<string, unknown>;
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

const useWebMarkdownDeps = () => {
  const [deps, setDeps] = React.useState<{
    ReactMarkdown: any;
    remarkMath: any;
    remarkGfm: any;
    rehypeKatex: any;
    rehypeSanitize: any;
  } | null>(null);

  React.useEffect(() => {
    if (!isWeb) return;

    let isMounted = true;

    (async () => {
      try {
        const [
          { default: ReactMarkdown },
          remarkMath,
          remarkGfm,
          rehypeKatex,
          rehypeSanitize,
        ] = await Promise.all([
          import('react-markdown'),
          import('remark-math'),
          import('remark-gfm'),
          import('rehype-katex'),
          import('rehype-sanitize'),
          // @ts-ignore: CSS imports are handled by Vite
          import('katex/dist/katex.min.css').catch(() => null),
        ]);

        const normalizePkg = (mod: any) => (mod ? (mod.default ?? mod) : null);
        const mathPlugin = normalizePkg(remarkMath);
        const gfmPlugin = normalizePkg(remarkGfm);
        const katexPlugin = normalizePkg(rehypeKatex);
        const sanitizePlugin = normalizePkg(rehypeSanitize);

        if (isMounted) {
          if (!mathPlugin || !gfmPlugin || !katexPlugin || !sanitizePlugin) {
            setDeps(null);
          } else {
            setDeps({
              ReactMarkdown,
              remarkMath: mathPlugin,
              remarkGfm: gfmPlugin,
              rehypeKatex: katexPlugin,
              rehypeSanitize: sanitizePlugin,
            });
          }
        }
      } catch {
        if (isMounted) setDeps(null);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

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

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className, style }) => {
  const safeContent = content ?? '';
  const deps = useWebMarkdownDeps();

  if (!isWeb) {
    return <MobileMarkdownText content={safeContent} style={style} />;
  }

  if (!deps) {
    return (
      <pre className={className} style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
        {safeContent}
      </pre>
    );
  }

  const { ReactMarkdown, remarkMath, remarkGfm, rehypeKatex, rehypeSanitize } = deps;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
};
