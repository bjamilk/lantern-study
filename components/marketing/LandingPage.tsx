import React, { useMemo } from 'react';
import {
  SparklesIcon,
  RectangleStackIcon,
  UserGroupIcon,
  DocumentTextIcon,
  AcademicCapIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { Button, Card, LanternIcon } from '../ui';
import { usePageSeo } from '../../hooks/usePageSeo';

interface LandingPageProps {
  onSignIn: () => void;
  onContinue: () => void;
}

const features = [
  { icon: DocumentTextIcon, title: 'Import PDF & PowerPoint', description: 'Turn lectures and slides into organized notes instantly.' },
  { icon: SparklesIcon, title: 'AI flashcards & quizzes', description: 'Generate study materials from any note in seconds.' },
  { icon: AcademicCapIcon, title: 'Learn, Match & Test modes', description: 'Spaced repetition, matching games, and practice tests — free.' },
  { icon: UserGroupIcon, title: 'Study with friends', description: 'Group chat, shared tests, and collaborative learning.' },
  { icon: ShoppingBagIcon, title: 'Explore marketplace', description: 'Browse study sets from students like you.' },
  { icon: RectangleStackIcon, title: 'Offline mode', description: 'Download decks and study anywhere.' },
];

const faqs = [
  { q: 'Is Lantern Study free?', a: 'Core study features — notes, flashcards, learn mode, and AI import — are free to use.' },
  { q: 'How is my data handled?', a: 'Your notes and study data are stored securely. See our Privacy Policy for details.' },
  { q: 'Can I study offline?', a: 'Yes. Download flashcard decks for offline review in the app.' },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, onContinue }) => {
  const seo = useMemo(
    () => ({
      title: 'Lantern Study — Flashcards, tests, groups & AI study tools',
      description:
        'Free study app with notes, AI flashcards, practice tests, study groups, and a deck marketplace. Built for slow connections and offline learning.',
      canonicalUrl: 'https://lanternstudy.com/',
      ogImage: 'https://lanternstudy.com/lantern-icon-v2.png',
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            name: 'Lantern Study',
            url: 'https://lanternstudy.com/',
            description:
              'Collaborative study platform with flashcards, practice tests, study groups, and AI tools.',
          },
          {
            '@type': 'FAQPage',
            mainEntity: faqs.map((faq) => ({
              '@type': 'Question',
              name: faq.q,
              acceptedAnswer: { '@type': 'Answer', text: faq.a },
            })),
          },
        ],
      },
    }),
    [],
  );
  usePageSeo(seo);

  return (
  <div className="min-h-screen bg-lantern-background text-lantern-text overflow-y-auto">
    <header className="border-b border-lantern-border/80 bg-lantern-surface/80 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LanternIcon size={32} />
          <span className="font-display text-xl font-semibold tracking-tight">Lantern Study</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSignIn}>Sign in</Button>
          <Button size="sm" onClick={onContinue}>Get started</Button>
        </div>
      </div>
    </header>

    <section className="relative max-w-6xl mx-auto px-4 pt-16 md:pt-24 pb-14 md:pb-20 text-center">
      <div className="pointer-events-none absolute inset-x-0 -top-8 h-72 bg-[radial-gradient(ellipse_at_center,rgba(79,70,229,0.14),transparent_65%)]" />
      <p className="relative text-sm font-semibold uppercase tracking-[0.18em] text-lantern-primary mb-4">
        Study with clarity
      </p>
      <h1 className="relative font-display text-4xl md:text-6xl font-semibold tracking-tight text-lantern-text max-w-3xl mx-auto leading-[1.1]">
        Lantern Study
      </h1>
      <p className="relative mt-5 text-lg md:text-xl text-lantern-text-secondary max-w-2xl mx-auto leading-relaxed">
        Notes, flashcards, and tests in one place — import your materials, generate study tools with AI, and learn with friends.
      </p>
      <div className="relative mt-9 flex flex-col sm:flex-row gap-3 justify-center">
        <Button size="lg" onClick={onContinue}>Continue on the website</Button>
        <Button size="lg" variant="secondary" onClick={onSignIn}>Sign in</Button>
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-4 py-12">
      <h2 className="font-display text-3xl font-semibold text-center mb-10 tracking-tight">Everything you need to study</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f) => (
          <Card key={f.title} variant="elevated" className="text-left h-full">
            <div className="w-10 h-10 rounded-xl bg-lantern-primary-background text-lantern-primary flex items-center justify-center mb-3">
              <f.icon className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lantern-text tracking-tight">{f.title}</h3>
            <p className="text-sm text-lantern-text-secondary mt-2 leading-relaxed">{f.description}</p>
          </Card>
        ))}
      </div>
    </section>

    <section className="max-w-3xl mx-auto px-4 py-12">
      <h2 className="font-display text-3xl font-semibold text-center mb-8 tracking-tight">Frequently asked questions</h2>
      <div className="space-y-3">
        {faqs.map((faq) => (
          <Card key={faq.q} padding="md">
            <h3 className="font-semibold text-lantern-text">{faq.q}</h3>
            <p className="text-sm text-lantern-text-secondary mt-2 leading-relaxed">{faq.a}</p>
          </Card>
        ))}
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-4 py-16 text-center">
      <Card variant="elevated" className="max-w-2xl mx-auto bg-gradient-to-br from-lantern-primary/8 to-lantern-accent/8">
        <h2 className="font-display text-3xl font-semibold mb-3 tracking-tight text-lantern-text">Ready to study?</h2>
        <p className="text-lantern-text-secondary mb-6">Join students using Lantern Study for notes, flashcards, and group tests.</p>
        <Button size="lg" onClick={onContinue}>Get started free</Button>
      </Card>
    </section>

    <footer className="border-t border-lantern-border py-6 text-center text-sm text-lantern-text-tertiary space-y-2">
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <a href="/marketplace" className="hover:text-lantern-text-secondary transition-colors">Explore marketplace</a>
        <a href="/privacy" className="hover:text-lantern-text-secondary transition-colors">Privacy</a>
        <a href="/terms" className="hover:text-lantern-text-secondary transition-colors">Terms</a>
        <a href="/cookies" className="hover:text-lantern-text-secondary transition-colors">Cookies</a>
      </nav>
      <p>© {new Date().getFullYear()} Lantern Study</p>
    </footer>
  </div>
  );
};

export default LandingPage;
