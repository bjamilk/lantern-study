import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User } from '../types';
import { AcademicCapIcon, AtSymbolIcon, LockClosedIcon, UserIcon, EyeIcon, EyeSlashIcon, ExclamationCircleIcon, PhoneIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type MatterType from 'matter-js';
import { supabase, fetchUserProfile, createUserProfile, checkUsernameAvailability, setCachedAuthToken, resendSignupConfirmation, sendPasswordResetEmail, verifySignupOtp, getWebAuthRedirectOrigin } from '../services/supabase';
import { useUIStore } from '../stores/uiStore';
import { LanternIcon } from './ui/LanternIcon';
import TurnstileWidget, { type TurnstileHandle } from './TurnstileWidget';
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
  const signupTurnstileRef = useRef<TurnstileHandle | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
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
      return getAuthRateLimitMessage(context === 'login' ? 'signup' : context);
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

  // Username validation regex: lowercase alphanumeric + underscore, 3-20 chars
  const usernameRegex = /^[a-z0-9_]{3,20}$/;

  // Debounced username availability check
  useEffect(() => {
    if (!username || authView !== 'signup') return;
    
    const normalizedUsername = username.toLowerCase().trim();
    
    // Validate format first
    if (!usernameRegex.test(normalizedUsername)) {
      setUsernameError('3-20 characters: letters, numbers, underscore only');
      setUsernameAvailable(null);
      return;
    }
    
    setUsernameError('');
    setCheckingUsername(true);
    
    const timeoutId = setTimeout(async () => {
      try {
        const isAvailable = await checkUsernameAvailability(normalizedUsername);

        setUsernameAvailable(isAvailable);
        if (!isAvailable) {
          setUsernameError('Username is already taken');
        }
      } catch (err) {
        console.error('Username check failed:', err);
      } finally {
        setCheckingUsername(false);
      }
    }, 500); // Debounce 500ms
    
    return () => clearTimeout(timeoutId);
  }, [username, authView]);

  // Handle OAuth sign in
  const handleSocialLogin = async (provider: 'google' | 'apple') => {
    try {
      setSocialLoading(provider);
      setError('');
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: window.location.origin,
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

  const countryCodes = [
    { code: '+1', name: 'United States/Canada' },
    { code: '+7', name: 'Russia/Kazakhstan' },
    { code: '+20', name: 'Egypt' },
    { code: '+27', name: 'South Africa' },
    { code: '+30', name: 'Greece' },
    { code: '+31', name: 'Netherlands' },
    { code: '+32', name: 'Belgium' },
    { code: '+33', name: 'France' },
    { code: '+34', name: 'Spain' },
    { code: '+36', name: 'Hungary' },
    { code: '+39', name: 'Italy' },
    { code: '+40', name: 'Romania' },
    { code: '+41', name: 'Switzerland' },
    { code: '+43', name: 'Austria' },
    { code: '+44', name: 'United Kingdom' },
    { code: '+45', name: 'Denmark' },
    { code: '+46', name: 'Sweden' },
    { code: '+47', name: 'Norway' },
    { code: '+48', name: 'Poland' },
    { code: '+49', name: 'Germany' },
    { code: '+51', name: 'Peru' },
    { code: '+52', name: 'Mexico' },
    { code: '+53', name: 'Cuba' },
    { code: '+54', name: 'Argentina' },
    { code: '+55', name: 'Brazil' },
    { code: '+56', name: 'Chile' },
    { code: '+57', name: 'Colombia' },
    { code: '+58', name: 'Venezuela' },
    { code: '+60', name: 'Malaysia' },
    { code: '+61', name: 'Australia' },
    { code: '+62', name: 'Indonesia' },
    { code: '+63', name: 'Philippines' },
    { code: '+64', name: 'New Zealand' },
    { code: '+65', name: 'Singapore' },
    { code: '+66', name: 'Thailand' },
    { code: '+81', name: 'Japan' },
    { code: '+82', name: 'South Korea' },
    { code: '+84', name: 'Vietnam' },
    { code: '+86', name: 'China' },
    { code: '+90', name: 'Turkey' },
    { code: '+91', name: 'India' },
    { code: '+92', name: 'Pakistan' },
    { code: '+93', name: 'Afghanistan' },
    { code: '+94', name: 'Sri Lanka' },
    { code: '+95', name: 'Myanmar' },
    { code: '+98', name: 'Iran' },
    { code: '+212', name: 'Morocco' },
    { code: '+213', name: 'Algeria' },
    { code: '+216', name: 'Tunisia' },
    { code: '+218', name: 'Libya' },
    { code: '+220', name: 'Gambia' },
    { code: '+221', name: 'Senegal' },
    { code: '+222', name: 'Mauritania' },
    { code: '+223', name: 'Mali' },
    { code: '+224', name: 'Guinea' },
    { code: '+225', name: 'Ivory Coast' },
    { code: '+226', name: 'Burkina Faso' },
    { code: '+227', name: 'Niger' },
    { code: '+228', name: 'Togo' },
    { code: '+229', name: 'Benin' },
    { code: '+230', name: 'Mauritius' },
    { code: '+231', name: 'Liberia' },
    { code: '+232', name: 'Sierra Leone' },
    { code: '+233', name: 'Ghana' },
    { code: '+234', name: 'Nigeria' },
    { code: '+235', name: 'Chad' },
    { code: '+236', name: 'Central African Republic' },
    { code: '+237', name: 'Cameroon' },
    { code: '+238', name: 'Cape Verde' },
    { code: '+239', name: 'São Tomé and Príncipe' },
    { code: '+240', name: 'Equatorial Guinea' },
    { code: '+241', name: 'Gabon' },
    { code: '+242', name: 'Republic of the Congo' },
    { code: '+243', name: 'Democratic Republic of the Congo' },
    { code: '+244', name: 'Angola' },
    { code: '+245', name: 'Guinea-Bissau' },
    { code: '+246', name: 'British Indian Ocean Territory' },
    { code: '+248', name: 'Seychelles' },
    { code: '+249', name: 'Sudan' },
    { code: '+250', name: 'Rwanda' },
    { code: '+251', name: 'Ethiopia' },
    { code: '+252', name: 'Somalia' },
    { code: '+253', name: 'Djibouti' },
    { code: '+254', name: 'Kenya' },
    { code: '+255', name: 'Tanzania' },
    { code: '+256', name: 'Uganda' },
    { code: '+257', name: 'Burundi' },
    { code: '+258', name: 'Mozambique' },
    { code: '+260', name: 'Zambia' },
    { code: '+261', name: 'Madagascar' },
    { code: '+262', name: 'Réunion/Mayotte' },
    { code: '+263', name: 'Zimbabwe' },
    { code: '+264', name: 'Namibia' },
    { code: '+265', name: 'Malawi' },
    { code: '+266', name: 'Lesotho' },
    { code: '+267', name: 'Botswana' },
    { code: '+268', name: 'Eswatini' },
    { code: '+269', name: 'Comoros' },
    { code: '+290', name: 'Saint Helena' },
    { code: '+291', name: 'Eritrea' },
    { code: '+297', name: 'Aruba' },
    { code: '+298', name: 'Faroe Islands' },
    { code: '+299', name: 'Greenland' },
    { code: '+350', name: 'Gibraltar' },
    { code: '+351', name: 'Portugal' },
    { code: '+352', name: 'Luxembourg' },
    { code: '+353', name: 'Ireland' },
    { code: '+354', name: 'Iceland' },
    { code: '+355', name: 'Albania' },
    { code: '+356', name: 'Malta' },
    { code: '+357', name: 'Cyprus' },
    { code: '+358', name: 'Finland' },
    { code: '+359', name: 'Bulgaria' },
    { code: '+370', name: 'Lithuania' },
    { code: '+371', name: 'Latvia' },
    { code: '+372', name: 'Estonia' },
    { code: '+373', name: 'Moldova' },
    { code: '+374', name: 'Armenia' },
    { code: '+375', name: 'Belarus' },
    { code: '+376', name: 'Andorra' },
    { code: '+377', name: 'Monaco' },
    { code: '+378', name: 'San Marino' },
    { code: '+380', name: 'Ukraine' },
    { code: '+381', name: 'Serbia' },
    { code: '+382', name: 'Montenegro' },
    { code: '+383', name: 'Kosovo' },
    { code: '+385', name: 'Croatia' },
    { code: '+386', name: 'Slovenia' },
    { code: '+387', name: 'Bosnia and Herzegovina' },
    { code: '+389', name: 'North Macedonia' },
    { code: '+420', name: 'Czech Republic' },
    { code: '+421', name: 'Slovakia' },
    { code: '+423', name: 'Liechtenstein' },
    { code: '+500', name: 'Falkland Islands' },
    { code: '+501', name: 'Belize' },
    { code: '+502', name: 'Guatemala' },
    { code: '+503', name: 'El Salvador' },
    { code: '+504', name: 'Honduras' },
    { code: '+505', name: 'Nicaragua' },
    { code: '+506', name: 'Costa Rica' },
    { code: '+507', name: 'Panama' },
    { code: '+508', name: 'Saint Pierre and Miquelon' },
    { code: '+509', name: 'Haiti' },
    { code: '+590', name: 'Guadeloupe' },
    { code: '+591', name: 'Bolivia' },
    { code: '+592', name: 'Guyana' },
    { code: '+593', name: 'Ecuador' },
    { code: '+594', name: 'French Guiana' },
    { code: '+595', name: 'Paraguay' },
    { code: '+596', name: 'Martinique' },
    { code: '+597', name: 'Suriname' },
    { code: '+598', name: 'Uruguay' },
    { code: '+599', name: 'Curaçao' },
    { code: '+670', name: 'East Timor' },
    { code: '+672', name: 'Antarctica' },
    { code: '+673', name: 'Brunei' },
    { code: '+674', name: 'Nauru' },
    { code: '+675', name: 'Papua New Guinea' },
    { code: '+676', name: 'Tonga' },
    { code: '+677', name: 'Solomon Islands' },
    { code: '+678', name: 'Vanuatu' },
    { code: '+679', name: 'Fiji' },
    { code: '+680', name: 'Palau' },
    { code: '+681', name: 'Wallis and Futuna' },
    { code: '+682', name: 'Cook Islands' },
    { code: '+683', name: 'Niue' },
    { code: '+684', name: 'American Samoa' },
    { code: '+685', name: 'Samoa' },
    { code: '+686', name: 'Kiribati' },
    { code: '+687', name: 'New Caledonia' },
    { code: '+688', name: 'Tuvalu' },
    { code: '+689', name: 'French Polynesia' },
    { code: '+690', name: 'Tokelau' },
    { code: '+691', name: 'Micronesia' },
    { code: '+692', name: 'Marshall Islands' },
    { code: '+850', name: 'North Korea' },
    { code: '+852', name: 'Hong Kong' },
    { code: '+853', name: 'Macau' },
    { code: '+855', name: 'Cambodia' },
    { code: '+856', name: 'Laos' },
    { code: '+880', name: 'Bangladesh' },
    { code: '+886', name: 'Taiwan' },
    { code: '+960', name: 'Maldives' },
    { code: '+961', name: 'Lebanon' },
    { code: '+962', name: 'Jordan' },
    { code: '+963', name: 'Syria' },
    { code: '+964', name: 'Iraq' },
    { code: '+965', name: 'Kuwait' },
    { code: '+966', name: 'Saudi Arabia' },
    { code: '+967', name: 'Yemen' },
    { code: '+968', name: 'Oman' },
    { code: '+970', name: 'Palestine' },
    { code: '+971', name: 'United Arab Emirates' },
    { code: '+972', name: 'Israel' },
    { code: '+973', name: 'Bahrain' },
    { code: '+974', name: 'Qatar' },
    { code: '+975', name: 'Bhutan' },
    { code: '+976', name: 'Mongolia' },
    { code: '+977', name: 'Nepal' },
    { code: '+992', name: 'Tajikistan' },
    { code: '+993', name: 'Turkmenistan' },
    { code: '+994', name: 'Azerbaijan' },
    { code: '+995', name: 'Georgia' },
    { code: '+996', name: 'Kyrgyzstan' },
    { code: '+998', name: 'Uzbekistan' },
  ];

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
        try {
          await sendPasswordResetEmail(email);
          setResetEmailSent(true);
          setError('');
          startResendCooldown();
        } catch (err) {
          setError(formatAuthError(err, 'reset'));
        }
      } else if (isLoginView) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (isEmailNotConfirmedError(error)) {
            goToVerifyEmail(email);
            return;
          }
          setError(formatAuthError(error, 'login'));
          return;
        }

        if (data.user) {
          await finishAuthSession(data.user);
        }
      } else {
        if (!firstName.trim() || !lastName.trim()) { setError('Please enter both first and last name.'); return; }
        if (!username.trim()) { setError('Please enter a username.'); return; }
        const normalizedUsername = username.toLowerCase().trim();
        if (!usernameRegex.test(normalizedUsername)) { setError('Username must be 3-20 characters, using only lowercase letters, numbers, and underscores.'); return; }
        if (usernameAvailable === false) { setError('This username is already taken. Please choose another.'); return; }
        if (!validateEmail(email)) { setError('Please enter a valid email address.'); return; }
        if (password.length < 6) { setError('Password must be at least 6 characters long.'); return; }
        if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

        const signupName = `${firstName.trim()} ${lastName.trim()}`;
        const signupPhone = phoneNumber.trim() ? `${countryCode}${phoneNumber.trim()}` : undefined;
        const signupMetadata = {
          name: signupName,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          username: normalizedUsername,
          ...(signupPhone ? { phone: signupPhone } : {}),
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
            ...(signupTurnstileToken ? { captchaToken: signupTurnstileToken } : {}),
          },
        });
        if (error) {
          if (error.message.includes('already registered') || error.status === 422) {
            setError('This email is already registered. Please log in instead.');
          } else if (isAuthRateLimitError(error)) {
            setError(formatAuthError(error, 'signup'));
          } else {
            setError(error.message);
          }
          return;
        }
        if (data.user) {
          try {
            await createUserProfile({
              id: data.user.id,
              name: signupName,
              username: normalizedUsername,
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              phone: signupPhone,
              points: 0,
              stats: {},
              settings: {},
              badges: []
            });
          } catch (insertError) {
            console.log('Profile create error via API (may already exist):', insertError);
          }

          if (data.session?.user) {
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

  const toggleView = () => {
    setAuthView(isLoginView ? 'signup' : 'login');
    setError('');
    setFirstName('');
    setLastName('');
    setUsername('');
    setUsernameError('');
    setUsernameAvailable(null);
    setEmail('');
    setPhoneNumber('');
    setCountryCode('+1');
    setPassword('');
    setConfirmPassword('');
    setResetEmailSent(false);
    setOtpCode('');
    setVerifyMessage('');
  };

  const showForgotPassword = () => {
    setAuthView('forgotPassword');
    setError('');
    setEmail('');
    setResetEmailSent(false);
    setOtpCode('');
    setVerifyMessage('');
  };

  const backToLogin = () => {
    setAuthView('login');
    setError('');
    setEmail('');
    setResetEmailSent(false);
    setOtpCode('');
    setVerifyMessage('');
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
                      ? 'Enter the 6-digit code sent to your email. You can also confirm via the link in the email.'
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
                            {!isLoginView && (
                            <div className="space-y-5 min-w-0">
                                    <div className="flex gap-2 sm:gap-4 min-w-0">
                                        <div className="w-1/2 min-w-0">
                                            <label htmlFor="firstName" className="sr-only">First Name</label>
                                            <div className="relative min-w-0">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><UserIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                                <input id="firstName" name="firstName" type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} title={firstName} className="w-full min-w-0 pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm" placeholder="First Name"/>
                                            </div>
                                        </div>
                                        <div className="w-1/2 min-w-0">
                                            <label htmlFor="lastName" className="sr-only">Last Name</label>
                                            <div className="relative min-w-0">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><UserIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                                <input id="lastName" name="lastName" type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} title={lastName} className="w-full min-w-0 pl-10 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm" placeholder="Last Name"/>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="username" className="sr-only">Username</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <span className="text-lantern-text-tertiary font-medium" aria-hidden="true">@</span>
                                            </div>
                                            <input 
                                                id="username" 
                                                name="username" 
                                                type="text" 
                                                autoComplete="username" 
                                                value={username} 
                                                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} 
                                                aria-invalid={usernameError ? true : undefined}
                                                aria-describedby={
                                                    usernameError
                                                        ? 'username-error'
                                                        : username && usernameAvailable === true
                                                          ? 'username-available'
                                                          : undefined
                                                }
                                                className={`w-full pl-8 pr-10 py-2.5 border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 ${
                                                    usernameError ? 'border-red-500 focus:ring-red-500' : 
                                                    usernameAvailable === true ? 'border-green-500 focus:ring-green-500' : 
                                                    'border-lantern-border focus:ring-lantern-primary'
                                                }`}
                                                placeholder="username"
                                                maxLength={20}
                                            />
                                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none" aria-hidden="true">
                                                {checkingUsername && (
                                                    <svg className="animate-spin h-5 w-5 text-lantern-text-tertiary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                )}
                                                {!checkingUsername && usernameAvailable === true && (
                                                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                                                )}
                                                {!checkingUsername && usernameError && (
                                                    <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                                                )}
                                            </div>
                                        </div>
                                        {usernameError && (
                                            <p id="username-error" role="alert" aria-live="polite" className="mt-1 text-xs text-red-500">{usernameError}</p>
                                        )}
                                        {!usernameError && username && usernameAvailable === true && (
                                            <p id="username-available" className="mt-1 text-xs text-green-500">@{username} is available!</p>
                                        )}
                                    </div>
                                    <div>
                                        <label htmlFor="phone" className="sr-only">Phone Number</label>
                                        <div className="flex min-w-0">
                                            <label htmlFor="country-code" className="sr-only">Country code</label>
                                            <select
                                                id="country-code"
                                                name="countryCode"
                                                value={countryCode}
                                                onChange={(e) => setCountryCode(e.target.value)}
                                                aria-label="Country code"
                                                className="w-20 sm:w-24 shrink-0 px-2 sm:px-3 py-2.5 border border-lantern-border rounded-l-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                                            >
                                                {countryCodes.map((country) => (
                                                    <option key={country.code} value={country.code}>
                                                        {country.code}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="relative flex-1 min-w-0">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><PhoneIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                                <input id="phone" name="phone" type="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full min-w-0 pl-10 pr-3 py-2.5 border-l-0 border border-lantern-border rounded-r-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm" placeholder="Phone Number"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            
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
                                    <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-form-error' : undefined} className="w-full pl-10 pr-10 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary" placeholder="Password"/>
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary hover:text-lantern-text-secondary focus:outline-none"><span className="sr-only">Toggle password visibility</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                </div>
                            </div>

                            {!isLoginView && (
                                <div>
                                    <label htmlFor="confirmPassword" className="sr-only">Confirm Password</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><LockClosedIcon className="h-5 w-5 text-lantern-text-tertiary" /></div>
                                        <input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 border border-lantern-border rounded-lg bg-lantern-background dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary" placeholder="Confirm Password"/>
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary hover:text-lantern-text-secondary focus:outline-none"><span className="sr-only">Toggle password visibility</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
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
                            Password reset email sent! Check your inbox.
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
                        
                        <p className="mt-4 text-xs text-center text-lantern-text-secondary">
                            Google and Apple sign-in require OAuth configuration in Supabase Dashboard
                        </p>
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