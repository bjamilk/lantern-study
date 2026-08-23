import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User } from '../types';
import { AcademicCapIcon, AtSymbolIcon, LockClosedIcon, UserIcon, EyeIcon, EyeSlashIcon, ExclamationCircleIcon, PhoneIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type MatterType from 'matter-js';
import { supabase, fetchUserProfile, createUserProfile, checkUsernameAvailability, setCachedAuthToken, resendSignupConfirmation, sendPasswordResetEmail, verifySignupOtp, getWebAuthRedirectOrigin } from '../services/supabase';
import { useUIStore } from '../stores/uiStore';
import { takeStashedAuthLinkError } from '../utils/authErrorHash';
import { LanternIcon } from './ui/LanternIcon';
import TurnstileWidget, { type TurnstileHandle, getTurnstileSitekey } from './TurnstileWidget';
import {
  LEGAL_PATHS,
  isEmailNotConfirmedError,
  isAuthRateLimitError,
  getAuthRateLimitMessage,
  isValidOtpCode,
  RESEND_COOLDOWN_SECONDS,
  formatSupabaseClientAuthError,
} from '@lantern/shared';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void;
}

type AuthView = 'login' | 'signup' | 'forgotPassword' | 'verifyEmail';

function pathToAuthView(pathname: string): AuthView {
  if (pathname.startsWith('/signup')) return 'signup';
  if (pathname.startsWith('/forgot-password')) return 'forgotPassword';
  if (pathname.startsWith('/verify-email')) return 'verifyEmail';
  return 'login';
}

function authViewToPath(view: AuthView): string {
  switch (view) {
    case 'signup':
      return '/signup';
    case 'forgotPassword':
      return '/forgot-password';
    case 'verifyEmail':
      return '/verify-email';
    default:
      return '/login';
  }
}

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path>
      <path fill="#FF3D00" d="m6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"></path>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.222 0-9.618-3.234-11.283-7.614l-6.522 5.025A20.01 20.01 0 0 0 24 44z"></path>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.574l6.19 5.238C42.022 36.372 44 30.65 44 24c0-1.341-.138-2.65-.389-3.917z"></path>
    </svg>
);

const AppleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
);

const AnimatedBackground = () => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MatterType.Engine | null>(null);
  const runnerRef = useRef<MatterType.Runner | null>(null);
  const { lowDataMode } = useUIStore();
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (lowDataMode || reduceMotion) return;

    const scene = sceneRef.current;
    if (!scene) return;

    let active = true;
    let MatterModule: typeof MatterType | null = null;
    let localEngine: MatterType.Engine | null = null;
    let localRunner: MatterType.Runner | null = null;
    let localRender: MatterType.Render | null = null;
    let resizeHandler: (() => void) | null = null;

    const loadMatterJs = (retriesLeft = 2): Promise<typeof MatterType> =>
      import('matter-js').catch((err) => {
        if (retriesLeft <= 0) throw err;
        return new Promise<void>((resolve) => setTimeout(resolve, 400)).then(() =>
          loadMatterJs(retriesLeft - 1)
        );
      });

    loadMatterJs().then((Matter) => {
      if (!active) return;
      MatterModule = Matter;

      const engine = Matter.Engine.create({ gravity: { y: 0 } });
      engineRef.current = engine;
      localEngine = engine;

      const render = Matter.Render.create({
        element: scene,
        engine: engine,
        options: {
          width: scene.clientWidth,
          height: scene.clientHeight,
          wireframes: false,
          background: 'transparent',
        },
      });
      localRender = render;

      const createShape = () => {
        const x = Math.random() * scene.clientWidth;
        const y = Math.random() * scene.clientHeight;
        const radius = Math.random() * 20 + 10;
        const sides = Math.floor(Math.random() * 3) + 3; // Triangle to pentagon
        const colors = ['#a5b4fc', '#818cf8', '#6366f1']; // Indigo palette
        const body = Matter.Bodies.polygon(x, y, sides, radius, {
          restitution: 0.9,
          friction: 0.01,
          render: {
            fillStyle: colors[Math.floor(Math.random() * colors.length)],
          },
        });
        Matter.Body.setVelocity(body, {
            x: (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2
        });
        return body;
      };
      
      const world = engine.world;
      const bodies = Array.from({ length: 15 }, createShape);
      Matter.World.add(world, bodies);
      
      // Walls to keep shapes contained
      const walls = [
        Matter.Bodies.rectangle(scene.clientWidth / 2, -10, scene.clientWidth, 20, { isStatic: true, render: { visible: false } }),
        Matter.Bodies.rectangle(scene.clientWidth / 2, scene.clientHeight + 10, scene.clientWidth, 20, { isStatic: true, render: { visible: false } }),
        Matter.Bodies.rectangle(-10, scene.clientHeight / 2, 20, scene.clientHeight, { isStatic: true, render: { visible: false } }),
        Matter.Bodies.rectangle(scene.clientWidth + 10, scene.clientHeight / 2, 20, scene.clientHeight, { isStatic: true, render: { visible: false } }),
      ];
      Matter.World.add(world, walls);

      Matter.Render.run(render);
      const runner = Matter.Runner.create();
      runnerRef.current = runner;
      localRunner = runner;
      Matter.Runner.run(runner, engine);

      resizeHandler = () => {
        if (!render.canvas) return;
        render.canvas.width = scene.clientWidth;
        render.canvas.height = scene.clientHeight;
        Matter.Body.setPosition(walls[0], { x: scene.clientWidth / 2, y: -10 });
        Matter.Body.setPosition(walls[1], { x: scene.clientWidth / 2, y: scene.clientHeight + 10 });
        Matter.Body.setPosition(walls[2], { x: -10, y: scene.clientHeight / 2 });
        Matter.Body.setPosition(walls[3], { x: scene.clientWidth + 10, y: scene.clientHeight / 2 });
      };

      window.addEventListener('resize', resizeHandler);
    }).catch(err => {
      console.error('Failed to load matter-js dynamically:', err);
    });

    return () => {
      active = false;
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      if (MatterModule) {
        if (localRunner) MatterModule.Runner.stop(localRunner);
        if (localRender) {
          MatterModule.Render.stop(localRender);
          if (localRender.canvas) {
            localRender.canvas.remove();
          }
          localRender.textures = {};
        }
        if (localEngine) MatterModule.Engine.clear(localEngine);
      }
    };
  }, [lowDataMode, reduceMotion]);

  if (lowDataMode || reduceMotion) return null;

  return <div ref={sceneRef} className="absolute inset-0 w-full h-full" />;
};


/**
 * Referral code for this signup, if any (Phase 4 · Q).
 *
 * Read from `?ref=` and mirrored into sessionStorage, because the code must
 * survive the login↔signup toggle and a bounce through the confirmation email.
 * Kept to a conservative charset/length so nothing odd reaches signup metadata.
 */
const REFERRAL_STORAGE_KEY = 'lantern_referral_code';

function readReferralCode(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ref');
    const candidate = (fromUrl || window.sessionStorage.getItem(REFERRAL_STORAGE_KEY) || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(candidate)) return null;
    if (fromUrl) window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, candidate);
    return candidate;
  } catch {
    return null;
  }
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const { lowDataMode } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const authView = pathToAuthView(location.pathname);
  const setAuthView = (view: AuthView) => {
    navigate(`${authViewToPath(view)}${location.search}`, { replace: false });
  };
  const isLoginView = authView === 'login';
  const isForgotPasswordView = authView === 'forgotPassword';
  const isVerifyEmailView = authView === 'verifyEmail';
  const [signupTurnstileToken, setSignupTurnstileToken] = useState('');
  const [turnstileLoadFailed, setTurnstileLoadFailed] = useState(false);
  const signupTurnstileRef = useRef<TurnstileHandle | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [authSubmitLoading, setAuthSubmitLoading] = useState(false);
  const [editingVerifyEmail, setEditingVerifyEmail] = useState(true);

  useEffect(() => {
    if (!isVerifyEmailView) return;
    // Prefilled (post-signup): show wrapping display. Cold visit: keep the editable field.
    setEditingVerifyEmail(!email.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset edit mode when entering verify view
  }, [isVerifyEmailView]);

  const formatAuthError = (err: unknown, context: 'signup' | 'resend' | 'reset' | 'login' = 'login'): string => {
    if (isAuthRateLimitError(err)) {
      // Each context gets its own copy — a login 429 used to show signup
      // email-quota text (with internal admin instructions) to a student
      // who'd merely retried a wrong password.
      return getAuthRateLimitMessage(context);
    }
    let message = 'An error occurred.';
    if (err instanceof Error) message = err.message;
    else if (typeof err === 'object' && err !== null && 'message' in err) {
      message = String((err as { message: unknown }).message);
    }
    return formatSupabaseClientAuthError(message);
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const startResendCooldown = () => setResendCooldown(RESEND_COOLDOWN_SECONDS);

  // Clear per-view transient state whenever the view changes — including via
  // the browser Back button, which bypasses every click handler. Without
  // this, a signup error or the reset-sent banner persisted onto other views.
  useEffect(() => {
    setError('');
    setVerifyMessage('');
    setResetEmailSent(false);
    setShowPassword(false);
    // A failed email link / cancelled OAuth captured at boot surfaces here.
    const linkError = takeStashedAuthLinkError();
    if (linkError) setError(linkError);
  }, [authView]);

  const finishAuthSession = async (authUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) => {
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) {
      setCachedAuthToken(session.access_token, authUser.id);
    }

    const meta = authUser.user_metadata || {};
    const metaFirstName = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
    const metaLastName = typeof meta.last_name === 'string' ? meta.last_name.trim() : '';
    const metaUsername = typeof meta.username === 'string' ? meta.username.toLowerCase().trim() : '';
    const metaPhone = typeof meta.phone === 'string' ? meta.phone.trim() : undefined;
    const metaName =
      (typeof meta.name === 'string' && meta.name.trim()) ||
      [metaFirstName, metaLastName].filter(Boolean).join(' ') ||
      authUser.email?.split('@')[0] ||
      'User';

    let profile: Awaited<ReturnType<typeof fetchUserProfile>> | null = null;
    try {
      profile = await fetchUserProfile(authUser.id);
    } catch (profileError: unknown) {
      const msg = profileError instanceof Error ? profileError.message : String(profileError);
      if (msg.includes('404') || msg.includes('status: 404')) {
        profile = await createUserProfile({
          id: authUser.id,
          name: metaName,
          username: metaUsername || undefined,
          first_name: metaFirstName || undefined,
          last_name: metaLastName || undefined,
          phone: metaPhone,
          points: 0,
          stats: {},
          settings: {},
          badges: [],
        });
      } else {
        throw profileError;
      }
    }

    if (!profile) {
      throw new Error('Failed to load user profile');
    }

    const user: User = {
      id: profile.id,
      name: profile.name,
      username: profile.username || undefined,
      firstName: profile.firstName || profile.first_name || undefined,
      lastName: profile.lastName || profile.last_name || undefined,
      avatarUrl: profile.avatarUrl || profile.avatar_url || '',
      email: authUser.email!,
      password: '',
      phoneNumber: profile.phoneNumber || profile.phone || '',
      points: profile.points,
      badges: profile.badges as User['badges'],
      stats: profile.stats,
    };
    onAuthSuccess(user);
  };

  const goToVerifyEmail = (verifyEmail: string) => {
    setEmail(verifyEmail);
    setEditingVerifyEmail(!verifyEmail.trim());
    setOtpCode('');
    setVerifyMessage('');
    setError('');
    setAuthView('verifyEmail');
  };

  // Handle OAuth sign in
  const handleSocialLogin = async (provider: 'google' | 'apple') => {
    try {
      setSocialLoading(provider);
      setError('');
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          // Return to /login with the original query so ?next= deep links
          // (group invites, note shares) survive the OAuth round-trip.
          redirectTo: `${window.location.origin}/login${window.location.search}`,
          queryParams: provider === 'google' ? {
            access_type: 'offline',
            prompt: 'consent',
          } : undefined,
        },
      });

      if (error) {
        console.error(`${provider} login error:`, error);
        setError(formatAuthError(error, 'login'));
        setSocialLoading(null);
      }
      // If successful, the page will redirect to the OAuth provider
    } catch (err) {
      console.error(`${provider} login error:`, err);
      setError(`Failed to sign in with ${provider}. Please try again.`);
      setSocialLoading(null);
    }
  };


  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authSubmitLoading) return;
    setError('');

    setAuthSubmitLoading(true);
    try {
      if (isVerifyEmailView) {
        await handleVerifyOtp();
        return;
      }
      if (isForgotPasswordView) {
        if (!validateEmail(email)) {
          setError('Please enter a valid email address.');
          return;
        }
        if (resendCooldown > 0) {
          // The secondary Resend button already respects this cooldown; the
          // main button used to fire straight into the server email limit.
          setError('A reset email was just sent. Wait a moment before requesting another.');
          return;
        }
        try {
          await sendPasswordResetEmail(email);
          setResetEmailSent(true);
          setError('');
          startResendCooldown();
        } catch (err) {
          setError(formatAuthError(err, 'reset'));
        }
      } else if (isLoginView) {
        // Validate client-side first: the server's bare "missing email or
        // phone" is internal copy (and this form has no phone field).
        if (!email.trim() || !password) {
          setError('Enter your email and password.');
          return;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (isEmailNotConfirmedError(error)) {
            goToVerifyEmail(email);
            return;
          }
          // Deliberately generic — never confirms whether the account exists.
          if (/invalid login credentials/i.test(error.message)) {
            setError('Incorrect email or password.');
            return;
          }
          setError(formatAuthError(error, 'login'));
          return;
        }

        if (data.user) {
          await finishAuthSession(data.user);
        }
      } else {
        if (!validateEmail(email)) { setError('Please enter a valid email address.'); return; }
        if (password.length < 8) { setError('Password must be at least 8 characters long.'); return; }
        // Fail closed: when the widget rendered, a submit needs its token.
        // (If the script itself couldn't load — ad blocker — we let the
        // attempt through and the server-side setting has the final word.)
        if (getTurnstileSitekey() && !signupTurnstileToken && !turnstileLoadFailed) {
          setError('Please complete the verification check above, then try again.');
          return;
        }
        if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

        // Minimal metadata: the post-signin onboarding modal collects username
        // and real names; until then the email prefix stands in as the name.
        const signupName = email.split('@')[0];
        // Phase 4 Q: referral attribution rides signUp metadata and is consumed
        // SERVER-SIDE by handle_new_user(). It deliberately is NOT read back in
        // finishAuthSession: confirming by clicking the emailed link never runs
        // that function (the session arrives via detectSessionInUrl and
        // AuthScreen unmounts), so a client-side consumer would silently lose
        // every email-link signup — the majority of them.
        const referralCode = readReferralCode();
        const signupMetadata = {
          name: signupName,
          ...(referralCode ? { referral_code: referralCode, referral_source: 'link' } : {}),
        };

        void import('../services/productAnalytics').then(({ trackSignupStarted }) => {
          trackSignupStarted();
        });
        
        // Supabase verifies this token itself, against the secret configured in
        // its own dashboard — signup never reaches our API, so there is no
        // handler here to run siteverify in. Sending the token while the
        // dashboard setting is still off is harmless: Supabase ignores it.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: signupMetadata,
            // The confirmation link should come back to THIS deployment, not
            // the dashboard Site URL (a preview signup's link landed on prod).
            emailRedirectTo: `${window.location.origin}/login${window.location.search}`,
            ...(signupTurnstileToken ? { captchaToken: signupTurnstileToken } : {}),
          },
        });
        if (error) {
          // Only the explicit message means "already registered" — a bare 422
          // also covers weak-password/invalid-domain, and telling those users
          // their email is taken sent them to a login that can't work.
          if (/already registered|user already exists/i.test(error.message)) {
            setError('This email is already registered. Please log in instead.');
          } else if (isAuthRateLimitError(error)) {
            setError(formatAuthError(error, 'signup'));
          } else {
            setError(formatAuthError(error, 'signup'));
          }
          return;
        }
        // Enumeration protection makes signUp return a FAKE success for an
        // existing confirmed email (user with no identities, no session, and
        // no email sent) — routing that to verify-email stranded the user
        // waiting for a code that never comes.
        if (data.user && !data.session && (data.user.identities?.length ?? 0) === 0) {
          setError('This email is already registered. Please log in instead.');
          return;
        }
        if (data.user) {
          // Only write the profile when signUp actually returned a session.
          // With email confirmation on it does not: there is no bearer token
          // yet, so POST /api/v1/users is guaranteed to 401 — it reported a
          // failed signup to Sentry while the signup had in fact succeeded.
          // Nothing is lost by skipping it, because finishAuthSession rebuilds
          // the profile from the same signup metadata (stored on the auth user)
          // the first time the confirmed account signs in.
          if (data.session?.user) {
            try {
              await createUserProfile({
                id: data.user.id,
                name: signupName,
                points: 0,
                stats: {},
                settings: {},
                badges: []
              });
            } catch (insertError) {
              console.log('Profile create error via API (may already exist):', insertError);
            }

            await finishAuthSession(data.session.user);
          } else {
            goToVerifyEmail(email);
          }
        }
      }
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setAuthSubmitLoading(false);
      // Single-use token, and this screen stays mounted on failure.
      if (signupTurnstileToken) {
        setSignupTurnstileToken('');
        signupTurnstileRef.current?.reset();
      }
    }
  };

  const handleVerifyOtp = async () => {
    if (!validateEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!isValidOtpCode(otpCode)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifyLoading(true);
    setError('');
    try {
      const data = await verifySignupOtp(email, otpCode);
      if (data.user) {
        setVerifyMessage('Email verified! Signing you in…');
        await finishAuthSession(data.user);
      } else {
        setVerifyMessage('Email verified! You can sign in now.');
        setAuthView('login');
      }
    } catch (err) {
      // Don't leave the green 'Signing you in…' banner above a failure.
      setVerifyMessage('');
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (resendCooldown > 0 || !validateEmail(email)) return;
    setResendLoading(true);
    setError('');
    try {
      await resendSignupConfirmation(email, getWebAuthRedirectOrigin());
      setVerifyMessage('Confirmation email sent. Check your inbox or enter the new code.');
      startResendCooldown();
    } catch (err) {
      setError(formatAuthError(err, 'resend'));
    } finally {
      setResendLoading(false);
    }
  };

  const handleResendResetEmail = async () => {
    if (resendCooldown > 0 || !validateEmail(email)) return;
    setResendLoading(true);
    setError('');
    try {
      await sendPasswordResetEmail(email);
      setResetEmailSent(true);
      startResendCooldown();
    } catch (err) {
      setError(formatAuthError(err, 'reset'));
    } finally {
      setResendLoading(false);
    }
  };

  // The typed email survives every view switch (a user who fails a password
  // and taps "Forgot your password?" should not retype it); passwords and
  // profile fields clear. Stale errors/banners are handled by the authView
  // effect below, which also covers browser Back/Forward.
  const toggleView = () => {
    setAuthView(isLoginView ? 'signup' : 'login');
    setPassword('');
    setConfirmPassword('');
    setOtpCode('');
  };

  const showForgotPassword = () => {
    setAuthView('forgotPassword');
    setOtpCode('');
  };

  const backToLogin = () => {
    setAuthView('login');
    setOtpCode('');
  };

  return (
    <main className="flex items-start justify-center min-h-[100dvh] overflow-y-auto overscroll-contain bg-lantern-background transition-colors duration-300 py-4 sm:items-center sm:py-6">
      <div className="w-full max-w-5xl m-4 lg:m-8 bg-lantern-surface/95 border border-lantern-border rounded-3xl shadow-lantern-lg overflow-hidden grid lg:grid-cols-2 backdrop-blur-sm">
        {/* Left Branding Column */}
        <div className={`hidden lg:block relative p-12 ${lowDataMode ? 'bg-lantern-accent-background' : 'bg-lantern-primary-background'}`}>
          {!lowDataMode && <AnimatedBackground />}
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
                <div className="flex items-center font-display text-2xl font-semibold tracking-tight text-lantern-text gap-3">
                    <LanternIcon size={40} />
                    <span>Lantern Study</span>
                </div>
                <p className="mt-4 text-lantern-text-secondary">Study smarter — built for slow connections and offline learning.</p>
            </div>
            <div className="mt-8 text-sm text-lantern-text-secondary">
                <p>"An investment in knowledge pays the best interest."</p>
                <p className="font-semibold mt-1">- Benjamin Franklin</p>
            </div>
          </div>
        </div>

        {/* Right Form Column — keep padding modest so short landscape can scroll to submit */}
        <div className="p-5 sm:p-10 lg:p-12 flex flex-col justify-center max-h-[100dvh] overflow-y-auto">
            <div className="w-full max-w-md mx-auto">
                <div className="text-center lg:hidden mb-4 sm:mb-8">
                    <LanternIcon size={48} className="mx-auto" />
                </div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-lantern-text">
                    {isVerifyEmailView
                      ? 'Verify your email'
                      : isForgotPasswordView
                        ? 'Reset Password'
                        : isLoginView
                          ? 'Welcome Back'
                          : 'Create an Account'}
                </h1>
                <p className="mt-2 text-sm text-lantern-text-secondary">
                    {isVerifyEmailView
                      ? 'Enter the 6-digit code from your email. If your code is old or never arrived, tap Resend below. You can also confirm via the link in the email. Not seeing it? Check your spam or promotions folder.'
                      : isForgotPasswordView
                        ? 'Enter your email to receive a reset link.'
                        : isLoginView
                          ? 'Sign in to continue your journey.'
                          : 'Join us to illuminate your mind.'}
                </p>

                <form className="mt-8 space-y-5 min-w-0" onSubmit={handleAuthAction} noValidate aria-describedby={error ? 'auth-form-error' : undefined}>
                    {isVerifyEmailView && (
                        <>
                            <div className="min-w-0">
                                <label htmlFor="verifyEmail" className="sr-only">Email address</label>
                                {email.trim() ? (
                                  <p
                                    className="mb-2 rounded-lg border border-lantern-border bg-lantern-background dark:bg-lantern-surface-secondary px-3 py-2.5 text-sm text-lantern-text break-all"
                                    data-testid="verify-email-display"
                                  >
                                    {email}
                                  </p>
                                ) : null}
                                {editingVerifyEmail || !email.trim() ? (
                                  <div className="relative min-w-0">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                      <AtSymbolIcon className="h-5 w-5 text-lantern-text-tertiary" />
                                    </div>
                                    <input
                                      id="verifyEmail"
                                      name="verifyEmail"
                                      type="email"
                                      autoComplete="email"
                                      required
                                      value={email}
                                      onChange={(e) => setEmail(e.target.value)}
                                      onBlur={() => {
                                        if (email.trim()) setEditingVerifyEmail(false);
                                      }}
                                      title={email}
                                      className="w-full min-w-0 pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm"
                                      placeholder="Email address"
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <input type="hidden" name="verifyEmail" value={email} required />
                                    <button
                                      type="button"
                                      className="min-h-10 text-xs text-lantern-primary underline"
                                      onClick={() => setEditingVerifyEmail(true)}
                                    >
                                      Edit email
                                    </button>
                                  </>
                                )}
                            </div>
                            <div>
                                <label htmlFor="otpCode" className="sr-only">Verification code</label>
                                <input
                                    id="otpCode"
                                    name="otpCode"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="w-full px-4 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-center text-2xl tracking-widest font-mono"
                                    placeholder="000000"
                                />
                            </div>
                        </>
                    )}

                    {!isForgotPasswordView && !isVerifyEmailView && (
                        <>
                            {/* Signup asks only for email + password. Username and name are
                                collected right after first sign-in (UsernameRequiredModal —
                                the same flow OAuth signups already use), and phone lives in
                                Profile settings. 7 fields → 3. */}
                            <div>
                                <label htmlFor="email" className="sr-only">Email address</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><AtSymbolIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                    <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-form-error' : undefined} title={email} className="w-full min-w-0 pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm" placeholder="Email address"/>
                                </div>
                            </div>
                            
                            <div>
                                <label htmlFor="password" className="sr-only">Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><LockClosedIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                    <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isLoginView ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-form-error' : undefined} className="w-full pl-10 pr-10 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary" placeholder="Password"/>
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary hover:text-lantern-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary rounded"><span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                </div>
                                {!isLoginView && (
                                    <p className="mt-1 text-xs text-lantern-text-tertiary">At least 8 characters.</p>
                                )}
                            </div>

                            {!isLoginView && (
                                <div>
                                    <label htmlFor="confirmPassword" className="sr-only">Confirm Password</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><LockClosedIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                        <input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary" placeholder="Confirm Password"/>
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary hover:text-lantern-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary rounded"><span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {isForgotPasswordView && (
                        <div>
                            <label htmlFor="resetEmail" className="sr-only">Email address</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><AtSymbolIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                <input id="resetEmail" name="resetEmail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary" placeholder="Email address"/>
                            </div>
                        </div>
                    )}

                    {error && (
                      <div id="auth-form-error" role="alert" className="flex items-center text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg">
                        <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0"/>
                        {error}
                      </div>
                    )}

                    {resetEmailSent && (
                        <div className="flex items-center text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded-lg">
                            <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0"/>
                            If an account exists for this email, a reset link is on its way. Check your inbox and spam folder.
                        </div>
                    )}

                    {verifyMessage && (
                        <div className="flex items-center text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded-lg">
                            <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0"/>
                            {verifyMessage}
                        </div>
                    )}

                    {!isLoginView && !isForgotPasswordView && !isVerifyEmailView && (
                        <TurnstileWidget
                            ref={signupTurnstileRef}
                            action="signup"
                            onLoadFailure={() => setTurnstileLoadFailed(true)}
                                    onToken={setSignupTurnstileToken}
                            onExpire={() => setSignupTurnstileToken('')}
                        />
                    )}

                    <div>
                        <button
                            type="submit"
                            disabled={verifyLoading || resendLoading || authSubmitLoading}
                            className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lantern text-white bg-lantern-primary hover:bg-lantern-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-lantern-primary/50 shadow-lantern transition-all hover:shadow-lantern-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isVerifyEmailView
                              ? verifyLoading ? 'Verifying…' : 'Verify email'
                              : isForgotPasswordView
                                ? authSubmitLoading ? 'Sending…' : resetEmailSent ? 'Send again' : 'Send Reset Email'
                                : isLoginView
                                  ? authSubmitLoading ? 'Signing in…' : 'Sign In'
                                  : authSubmitLoading ? 'Creating account…' : 'Create Account'}
                        </button>
                    </div>

                    {isVerifyEmailView && (
                        <button
                            type="button"
                            onClick={handleResendConfirmation}
                            disabled={resendCooldown > 0 || resendLoading}
                            className="w-full text-sm font-medium text-lantern-primary hover:text-lantern-primary disabled:text-lantern-text-tertiary disabled:cursor-not-allowed"
                        >
                            {resendLoading
                              ? 'Sending…'
                              : resendCooldown > 0
                                ? `Resend confirmation email (${resendCooldown}s)`
                                : 'Resend confirmation email'}
                        </button>
                    )}

                    {isForgotPasswordView && resetEmailSent && (
                        <button
                            type="button"
                            onClick={handleResendResetEmail}
                            disabled={resendCooldown > 0 || resendLoading}
                            className="w-full text-sm font-medium text-lantern-primary hover:text-lantern-primary disabled:text-lantern-text-tertiary disabled:cursor-not-allowed"
                        >
                            {resendLoading
                              ? 'Sending…'
                              : resendCooldown > 0
                                ? `Resend reset email (${resendCooldown}s)`
                                : 'Resend reset email'}
                        </button>
                    )}

                    {authView === 'signup' && (
                        <p className="text-xs text-center text-lantern-text-secondary">
                            By signing up, you agree to our{' '}
                            <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" className="text-lantern-primary hover:underline">
                                Terms of Service
                            </a>{' '}
                            and{' '}
                            <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="text-lantern-primary hover:underline">
                                Privacy Policy
                            </a>
                            .
                        </p>
                    )}
                </form>

                {isVerifyEmailView && (
                    <div className="mt-4 text-center">
                        <button onClick={backToLogin} className="text-sm text-lantern-primary hover:text-lantern-primary">
                            ← Back to Sign In
                        </button>
                    </div>
                )}

                {isLoginView && (
                    <div className="mt-4 text-center">
                        <button onClick={showForgotPassword} className="text-sm text-lantern-primary hover:text-lantern-primary">
                            Forgot your password?
                        </button>
                    </div>
                )}

                {isForgotPasswordView && (
                    <div className="mt-4 text-center">
                        <button onClick={backToLogin} className="text-sm text-lantern-primary hover:text-lantern-primary">
                            ← Back to Sign In
                        </button>
                    </div>
                )}

                {!isForgotPasswordView && !isVerifyEmailView && (
                    <>
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-lantern-border" /></div>
                            <div className="relative flex justify-center text-sm"><span className="px-2 bg-lantern-surface text-lantern-text-secondary">Or continue with</span></div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                type="button" 
                                onClick={() => handleSocialLogin('google')} 
                                disabled={socialLoading !== null}
                                className="w-full inline-flex justify-center items-center py-2.5 px-4 border border-lantern-border rounded-lg shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary text-sm font-medium text-lantern-text-secondary dark:text-lantern-text-tertiary hover:bg-lantern-background dark:hover:bg-lantern-border disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <span className="sr-only">Sign in with Google</span>
                                {socialLoading === 'google' ? (
                                    <svg className="animate-spin h-5 w-5 text-lantern-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <GoogleIcon/>
                                )}
                            </button>
                            <button 
                                type="button" 
                                onClick={() => handleSocialLogin('apple')} 
                                disabled={socialLoading !== null}
                                className="w-full inline-flex justify-center items-center py-2.5 px-4 border border-lantern-border rounded-lg shadow-sm bg-lantern-surface dark:bg-lantern-surface-secondary text-sm font-medium text-lantern-text hover:bg-lantern-background dark:hover:bg-lantern-border disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <span className="sr-only">Sign in with Apple</span>
                                {socialLoading === 'apple' ? (
                                    <svg className="animate-spin h-5 w-5 text-lantern-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <AppleIcon/>
                                )}
                            </button>
                        </div>
                    </>
                )}

                <div className="mt-8 text-sm text-center">
                    {!isForgotPasswordView && !isVerifyEmailView && (
                        <button onClick={toggleView} className="font-medium text-lantern-primary hover:text-lantern-primary">
                            {isLoginView ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                        </button>
                    )}
                </div>
            </div>
        </div>
      </div>
    </main>
  );
};

export default AuthScreen;