import React from 'react';
import { getPlatform } from '../config';

// Web renderer uses react-markdown + KaTeX
// Mobile renderer uses react-native-math-view for inline TeX

export interface MarkdownRendererProps {
  content?: string;
  className?: string;
}

const isWeb = getPlatform() === 'web';

// Lazy imports to avoid bundling/react native conflicts
let MathView: any;

// react-native-math-view is only available in React Native / Expo environment
if (!isWeb && typeof require !== 'undefined') {
  const requireFunc = require;
  MathView = requireFunc('react-native-math-view').MathView;
}

const useWebMarkdownDeps = () => {
  const [deps, setDeps] = React.useState<{
    ReactMarkdown: any;
    remarkMath: any;
    remarkGfm: any;
    rehypeKatex: any;
  } | null>(null);

  React.useEffect(() => {
    if (!isWeb) return;

    let isMounted = true;

    (async () => {
      try {
        const [{ default: ReactMarkdown }, remarkMath, remarkGfm, rehypeKatex] = await Promise.all([
          import('react-markdown'),
          import('remark-math'),
          import('remark-gfm'),
          import('rehype-katex'),
          // Load KaTeX CSS only in web environments
          // @ts-ignore: CSS imports are handled by Vite, but TS doesn't have types for it
          import('katex/dist/katex.min.css').catch(() => null),
        ]);

        const normalizePkg = (mod: any) => (mod ? (mod.default ?? mod) : null);
        const mathPlugin = normalizePkg(remarkMath);
        const gfmPlugin = normalizePkg(remarkGfm);
        const katexPlugin = normalizePkg(rehypeKatex);

        if (isMounted) {
          // If any plugin didn’t resolve properly, skip setting deps to avoid passing empty presets to react-markdown.
          if (!mathPlugin || !gfmPlugin || !katexPlugin) {
            setDeps(null);
          } else {
            setDeps({ ReactMarkdown, remarkMath: mathPlugin, remarkGfm: gfmPlugin, rehypeKatex: katexPlugin });
          }
        }
      } catch {
        // If imports fail (e.g., in unit tests or odd environments), just keep deps null
        if (isMounted) setDeps(null);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  return deps;
};

const renderMobile = (content: string) => {
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

  return (
    <>
      {segments.map((segment, idx) => {
        if (segment.type === 'math' && MathView) {
          return <MathView key={idx} math={segment.value} resizeMode="cover" />;
        }
        return <React.Fragment key={idx}>{segment.value}</React.Fragment>;
      })}
    </>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  const safeContent = content ?? '';
  const deps = useWebMarkdownDeps();

  if (isWeb) {
    // If deps haven't loaded yet, just render plaintext to avoid crashes.
    if (!deps) {
      return <div className={className}>{safeContent}</div>;
    }

    const { ReactMarkdown, remarkMath, remarkGfm, rehypeKatex } = deps;

    return (
      <div className={className}>
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          }}
        >
          {safeContent}
        </ReactMarkdown>
      </div>
    );
  }

  return <>{renderMobile(safeContent)}</>;
};
