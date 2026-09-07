import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AcademicCapIcon, QrCodeIcon, UserGroupIcon, BuildingLibraryIcon } from '@heroicons/react/24/outline';
import { TEACH_LOGIN_PATH, TEACH_SIGNUP_PATH } from '@lantern/shared/academic';
import { Button, Card, LanternIcon } from '../ui';
import { usePageSeo } from '../../hooks/usePageSeo';
import { markTeachSignupIntent } from '../../utils/teachIntent';

const points = [
  {
    icon: BuildingLibraryIcon,
    title: 'Any school',
    description: 'Primary, secondary, college, polytechnic or university. Type your school if it is not listed.',
  },
  {
    icon: AcademicCapIcon,
    title: 'A course or one topic',
    description: 'Run a whole subject, or just the topic you teach — Fractions, Photosynthesis, Essay writing.',
  },
  {
    icon: QrCodeIcon,
    title: 'Join codes in the hall',
    description: 'Students join with a 6-character code or QR. No Canvas, Google Classroom or Moodle required.',
  },
  {
    icon: UserGroupIcon,
    title: 'Students stay free',
    description: 'You publish notes and assignments. Students keep their private notes. Seats are not billed.',
  },
];

export const TeachLandingPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    markTeachSignupIntent();
  }, []);

  usePageSeo({
    title: 'Teach on Lantern Study — classes for any school',
    description:
      'Instructors at primary, secondary and tertiary schools can create a class, share a join code, and publish materials. Students stay free.',
    canonicalUrl: 'https://lanternstudy.com/teach',
  });

  return (
    <div className="min-h-screen bg-lantern-background text-lantern-text overflow-y-auto">
      <header className="border-b border-lantern-border/80 bg-lantern-surface/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <button type="button" className="flex items-center gap-2.5" onClick={() => navigate('/')}>
            <LanternIcon size={32} />
            <span className="font-display text-xl font-semibold tracking-tight">Lantern Study</span>
          </button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate(TEACH_LOGIN_PATH)}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate(TEACH_SIGNUP_PATH)}>
              Create instructor account
            </Button>
          </div>
        </div>
      </header>

      <section className="relative max-w-6xl mx-auto px-4 pt-16 md:pt-24 pb-14 md:pb-20 text-center">
        <p className="relative text-sm font-semibold uppercase tracking-[0.18em] text-lantern-primary mb-4">
          For instructors
        </p>
        <h1 className="relative font-display text-4xl md:text-6xl font-semibold tracking-tight text-lantern-text max-w-3xl mx-auto leading-[1.1]">
          Start a class from any school
        </h1>
        <p className="relative mt-5 text-lg md:text-xl text-lantern-text-secondary max-w-2xl mx-auto leading-relaxed">
          Primary, secondary and university lecturers can register their school, create a course or a single topic, and invite students with a code the same day.
        </p>
        <div className="relative mt-9 flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" onClick={() => navigate(TEACH_SIGNUP_PATH)}>
            Create a free instructor account
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate(TEACH_LOGIN_PATH)}>
            Sign in to Teach
          </Button>
        </div>
        <p className="relative mt-4 text-sm text-lantern-text-tertiary">
          Looking to study?{' '}
          <button type="button" className="text-lantern-primary font-medium" onClick={() => navigate('/')}>
            Student home
          </button>
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {points.map((item) => (
            <Card key={item.title} variant="elevated" className="text-left h-full">
              <div className="w-10 h-10 rounded-xl bg-lantern-primary-background text-lantern-primary flex items-center justify-center mb-3">
                <item.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-lantern-text tracking-tight">{item.title}</h3>
              <p className="text-sm text-lantern-text-secondary mt-2 leading-relaxed">{item.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
};

export default TeachLandingPage;
