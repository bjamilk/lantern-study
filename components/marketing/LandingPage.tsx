import React from 'react';
import {
  SparklesIcon,
  RectangleStackIcon,
  UserGroupIcon,
  DocumentTextIcon,
  AcademicCapIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { Button, LanternIcon } from '../ui';

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

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, onContinue }) => (
  <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-y-auto">
    <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LanternIcon size={32} />
          <span className="font-bold text-lg">Lantern Study</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSignIn}>Sign in</Button>
          <Button size="sm" onClick={onContinue}>Get started</Button>
        </div>
      </div>
    </header>

    <section className="max-w-6xl mx-auto px-4 py-16 md:py-24 text-center">
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white max-w-3xl mx-auto">
        Every AI study tool you need — notes, flashcards, and tests in one place
      </h1>
      <p className="mt-6 text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
        Import your materials, generate flashcards with AI, and study with learn mode, matching games, and practice tests. Built for students who study together.
      </p>
      <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
        <Button size="lg" onClick={onContinue}>Continue on the website</Button>
        <Button size="lg" variant="secondary" onClick={onSignIn}>Sign in</Button>
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-4 py-12">
      <h2 className="text-2xl font-bold text-center mb-10">Study smarter, not harder</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f) => (
          <div key={f.title} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <f.icon className="w-8 h-8 text-indigo-600 dark:text-indigo-400 mb-3" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{f.title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{f.description}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="max-w-3xl mx-auto px-4 py-12">
      <h2 className="text-2xl font-bold text-center mb-8">Frequently asked questions</h2>
      <div className="space-y-4">
        {faqs.map((faq) => (
          <div key={faq.q} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{faq.q}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{faq.a}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-4 py-16 text-center border-t border-slate-200 dark:border-slate-700">
      <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Ready to study?</h2>
      <p className="text-slate-600 dark:text-slate-300 mb-6">Join students using Lantern Study for notes, flashcards, and group tests.</p>
      <Button size="lg" onClick={onContinue}>Get started free</Button>
    </section>

    <footer className="border-t border-slate-200 dark:border-slate-700 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
      © {new Date().getFullYear()} Lantern Study
    </footer>
  </div>
);

export default LandingPage;
