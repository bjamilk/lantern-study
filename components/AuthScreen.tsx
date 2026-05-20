import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { AcademicCapIcon, AtSymbolIcon, LockClosedIcon, UserIcon, EyeIcon, EyeSlashIcon, ExclamationCircleIcon, PhoneIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import Matter from 'matter-js';
import { supabase } from '../services/supabase';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void;
}

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path>
      <path fill="#FF3D00" d="m6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"></path>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.222 0-9.618-3.234-11.283-7.614l-6.522 5.025A20.01 20.01 0 0 0 24 44z"></path>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.574l6.19 5.238C42.022 36.372 44 30.65 44 24c0-1.341-.138-2.65-.389-3.917z"></path>
    </svg>
);

const FacebookIcon = () => (
    <svg className="w-5 h-5 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
    </svg>
);

const TwitterIcon = () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
);

const AnimatedBackground = () => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const engine = Matter.Engine.create({ gravity: { y: 0 } });
    engineRef.current = engine;
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
    Matter.Runner.run(runner, engine);

    const handleResize = () => {
      render.canvas.width = scene.clientWidth;
      render.canvas.height = scene.clientHeight;
      Matter.Body.setPosition(walls[0], { x: scene.clientWidth / 2, y: -10 });
      Matter.Body.setPosition(walls[1], { x: scene.clientWidth / 2, y: scene.clientHeight + 10 });
      Matter.Body.setPosition(walls[2], { x: -10, y: scene.clientHeight / 2 });
      Matter.Body.setPosition(walls[3], { x: scene.clientWidth + 10, y: scene.clientHeight / 2 });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
      Matter.Render.stop(render);
      Matter.Engine.clear(engine);
      render.canvas.remove();
      render.textures = {};
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <div ref={sceneRef} className="absolute inset-0 w-full h-full" />;
};


const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [isLoginView, setIsLoginView] = useState(true);
  const [isForgotPasswordView, setIsForgotPasswordView] = useState(false);
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
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | 'twitter' | null>(null);

  // Username validation regex: lowercase alphanumeric + underscore, 3-20 chars
  const usernameRegex = /^[a-z0-9_]{3,20}$/;

  // Debounced username availability check
  useEffect(() => {
    if (!username || isLoginView) return;
    
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
        const { data, error } = await supabase.rpc('is_username_available', {
          check_username: normalizedUsername,
        });

        if (error) {
          console.error('Username check error:', error);
          setCheckingUsername(false);
          return;
        }

        setUsernameAvailable(data === true);
        if (data === false) {
          setUsernameError('Username is already taken');
        }
      } catch (err) {
        console.error('Username check failed:', err);
      } finally {
        setCheckingUsername(false);
      }
    }, 500); // Debounce 500ms
    
    return () => clearTimeout(timeoutId);
  }, [username, isLoginView]);

  // Handle OAuth sign in
  const handleSocialLogin = async (provider: 'google' | 'facebook' | 'twitter') => {
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
        setError(error.message);
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
    setError('');

    try {
      if (isForgotPasswordView) {
        if (!validateEmail(email)) {
          setError('Please enter a valid email address.');
          return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          setError(error.message);
          return;
        }
        setResetEmailSent(true);
        setError('');
      } else if (isLoginView) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        
        // Store the access token for API calls
        if (data.session?.access_token) {
          localStorage.setItem('lantern_access_token', data.session.access_token);
          localStorage.setItem('lantern_refresh_token', data.session.refresh_token);
          console.log('[Auth] Stored access token to localStorage');
        }
        
        // Fetch profile
        let { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', data.user!.id).single();
        
        // If profile doesn't exist, create one (handles database reset scenarios)
        if (profileError || !profile) {
          const userName = data.user!.user_metadata?.name || data.user!.email?.split('@')[0] || 'User';
          const { data: newProfile, error: insertError } = await supabase.from('profiles').insert({
            id: data.user!.id,
            name: userName,
            phone: null,
            points: 0,
            stats: {},
            settings: {},
            badges: []
          }).select().single();
          
          if (insertError || !newProfile) {
            setError('Failed to create profile. Please try again.');
            return;
          }
          profile = newProfile;
        }
        
        const user: User = {
          id: profile.id,
          name: profile.name,
          username: profile.username || undefined,
          firstName: profile.first_name || undefined,
          lastName: profile.last_name || undefined,
          avatarUrl: profile.avatar_url || '',
          email: data.user!.email!,
          password: '', // not stored
          phoneNumber: profile.phone || '',
          points: profile.points,
          badges: profile.badges as any[], // assume Badge[]
          stats: profile.stats
        };
        console.log('[Auth] Login successful, calling onAuthSuccess with user:', user.id, user.name);
        onAuthSuccess(user);
      } else {
        if (!firstName.trim() || !lastName.trim()) { setError('Please enter both first and last name.'); return; }
        if (!username.trim()) { setError('Please enter a username.'); return; }
        const normalizedUsername = username.toLowerCase().trim();
        if (!usernameRegex.test(normalizedUsername)) { setError('Username must be 3-20 characters, using only lowercase letters, numbers, and underscores.'); return; }
        if (usernameAvailable === false) { setError('This username is already taken. Please choose another.'); return; }
        if (!validateEmail(email)) { setError('Please enter a valid email address.'); return; }
        if (password.length < 6) { setError('Password must be at least 6 characters long.'); return; }
        if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
        
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          // Handle common signup errors
          if (error.message.includes('already registered') || error.status === 422) {
            setError('This email is already registered. Please log in instead.');
          } else {
            setError(error.message);
          }
          return;
        }
        if (data.user) {
          // Insert profile with username
          const { error: insertError } = await supabase.from('profiles').insert({
            id: data.user.id,
            name: `${firstName.trim()} ${lastName.trim()}`,
            username: username.toLowerCase().trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phoneNumber.trim() ? `${countryCode}${phoneNumber.trim()}` : null,
            points: 0,
            stats: {},
            settings: {},
            badges: []
          });
          if (insertError) {
            // Profile might already exist if user previously signed up
            console.log('Profile insert error (may already exist):', insertError);
          }
          // Sign in
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) {
            setError(signInError.message);
            return;
          }
          
          // Store the access token for API calls
          if (signInData.session?.access_token) {
            localStorage.setItem('lantern_access_token', signInData.session.access_token);
            localStorage.setItem('lantern_refresh_token', signInData.session.refresh_token);
            console.log('[Auth] Stored access token to localStorage after signup');
          }
          
          const user: User = {
            id: data.user.id,
            name: `${firstName.trim()} ${lastName.trim()}`,
            username: username.toLowerCase().trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            avatarUrl: '',
            email,
            password,
            phoneNumber: phoneNumber.trim() ? `${countryCode}${phoneNumber.trim()}` : '',
            points: 0,
            badges: [],
            stats: {}
          };
          onAuthSuccess(user);
        }
      }
    } catch (err) {
      setError('An error occurred.');
    }
  };

  const toggleView = () => {
    setIsLoginView(!isLoginView);
    setIsForgotPasswordView(false);
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
  };

  const showForgotPassword = () => {
    setIsForgotPasswordView(true);
    setIsLoginView(true); // Keep login view but show forgot
    setError('');
    setEmail('');
    setResetEmailSent(false);
  };

  const backToLogin = () => {
    setIsForgotPasswordView(false);
    setError('');
    setEmail('');
    setResetEmailSent(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900 transition-colors duration-300">
      <div className="w-full max-w-5xl m-4 lg:m-8 bg-white dark:bg-slate-800/50 dark:border dark:border-slate-700 rounded-3xl shadow-2xl overflow-hidden grid lg:grid-cols-2">
        {/* Left Branding Column */}
        <div className="hidden lg:block relative p-12 bg-indigo-50 dark:bg-slate-800">
          <AnimatedBackground />
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
                <div className="flex items-center text-2xl font-bold text-slate-900 dark:text-slate-100">
                    <AcademicCapIcon className="w-10 h-10 mr-3 text-indigo-500" />
                    <span>Lantern Study</span>
                </div>
                <p className="mt-4 text-slate-600 dark:text-slate-300">The ultimate collaborative learning platform designed to help you succeed.</p>
            </div>
            <div className="mt-8 text-sm text-slate-500 dark:text-slate-400">
                <p>"An investment in knowledge pays the best interest."</p>
                <p className="font-semibold mt-1">- Benjamin Franklin</p>
            </div>
          </div>
        </div>

        {/* Right Form Column */}
        <div className="p-8 sm:p-12 flex flex-col justify-center">
            <div className="w-full max-w-md mx-auto">
                <div className="text-center lg:hidden mb-8">
                    <AcademicCapIcon className="w-12 h-12 mx-auto text-indigo-500" />
                </div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {isForgotPasswordView ? 'Reset Password' : isLoginView ? 'Welcome Back!' : 'Create an Account'}
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {isForgotPasswordView ? 'Enter your email to receive a reset link.' : isLoginView ? 'Sign in to continue your journey.' : 'Join us to illuminate your mind.'}
                </p>

                <form className="mt-8 space-y-5" onSubmit={handleAuthAction}>
                    {!isForgotPasswordView && (
                        <>
                            <div className={`transition-all duration-500 ease-in-out ${!isLoginView ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                                <div className="space-y-5">
                                    <div className="flex space-x-4">
                                        <div className="w-1/2">
                                            <label htmlFor="firstName" className="sr-only">First Name</label>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><UserIcon className="h-5 w-5 text-slate-400" /></div>
                                                <input id="firstName" name="firstName" type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="First Name"/>
                                            </div>
                                        </div>
                                        <div className="w-1/2">
                                            <label htmlFor="lastName" className="sr-only">Last Name</label>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><UserIcon className="h-5 w-5 text-slate-400" /></div>
                                                <input id="lastName" name="lastName" type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Last Name"/>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="username" className="sr-only">Username</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <span className="text-slate-400 font-medium">@</span>
                                            </div>
                                            <input 
                                                id="username" 
                                                name="username" 
                                                type="text" 
                                                autoComplete="username" 
                                                value={username} 
                                                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} 
                                                className={`w-full pl-8 pr-10 py-2.5 border rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 ${
                                                    usernameError ? 'border-red-500 focus:ring-red-500' : 
                                                    usernameAvailable === true ? 'border-green-500 focus:ring-green-500' : 
                                                    'border-slate-300 dark:border-slate-600 focus:ring-indigo-500'
                                                }`}
                                                placeholder="username"
                                                maxLength={20}
                                            />
                                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                                {checkingUsername && (
                                                    <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
                                            <p className="mt-1 text-xs text-red-500">{usernameError}</p>
                                        )}
                                        {!usernameError && username && usernameAvailable === true && (
                                            <p className="mt-1 text-xs text-green-500">@{username} is available!</p>
                                        )}
                                    </div>
                                    <div>
                                        <label htmlFor="phone" className="sr-only">Phone Number</label>
                                        <div className="flex">
                                            <select
                                                value={countryCode}
                                                onChange={(e) => setCountryCode(e.target.value)}
                                                className="w-24 px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-l-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {countryCodes.map((country) => (
                                                    <option key={country.code} value={country.code}>
                                                        {country.code}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="relative flex-1">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><PhoneIcon className="h-5 w-5 text-slate-400" /></div>
                                                <input id="phone" name="phone" type="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border-l-0 border border-slate-300 dark:border-slate-600 rounded-r-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Phone Number"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label htmlFor="email" className="sr-only">Email address</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><AtSymbolIcon className="h-5 w-5 text-slate-400" /></div>
                                    <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Email address"/>
                                </div>
                            </div>
                            
                            <div>
                                <label htmlFor="password" className="sr-only">Password</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><LockClosedIcon className="h-5 w-5 text-slate-400" /></div>
                                    <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Password"/>
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"><span className="sr-only">Toggle password visibility</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                </div>
                            </div>

                            {!isLoginView && (
                                <div>
                                    <label htmlFor="confirmPassword" className="sr-only">Confirm Password</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><LockClosedIcon className="h-5 w-5 text-slate-400" /></div>
                                        <input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Confirm Password"/>
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"><span className="sr-only">Toggle password visibility</span>{showPassword ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {isForgotPasswordView && (
                        <div>
                            <label htmlFor="resetEmail" className="sr-only">Email address</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><AtSymbolIcon className="h-5 w-5 text-slate-400" /></div>
                                <input id="resetEmail" name="resetEmail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Email address"/>
                            </div>
                        </div>
                    )}

                    {error && (<div className="flex items-center text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-lg"><ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0"/>{error}</div>)}

                    {resetEmailSent && (
                        <div className="flex items-center text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded-lg">
                            <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0"/>
                            Password reset email sent! Check your inbox.
                        </div>
                    )}

                    <div>
                        <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-800 focus:ring-indigo-500 transition-transform hover:scale-105">
                            {isForgotPasswordView ? 'Send Reset Email' : isLoginView ? 'Sign In' : 'Create Account'}
                        </button>
                    </div>
                </form>

                {isLoginView && !isForgotPasswordView && (
                    <div className="mt-4 text-center">
                        <button onClick={showForgotPassword} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500">
                            Forgot your password?
                        </button>
                    </div>
                )}

                {isForgotPasswordView && (
                    <div className="mt-4 text-center">
                        <button onClick={backToLogin} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500">
                            ← Back to Sign In
                        </button>
                    </div>
                )}

                {!isForgotPasswordView && (
                    <>
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-300 dark:border-slate-600" /></div>
                            <div className="relative flex justify-center text-sm"><span className="px-2 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400">Or continue with</span></div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-3">
                            <button 
                                type="button" 
                                onClick={() => handleSocialLogin('google')} 
                                disabled={socialLoading !== null}
                                className="w-full inline-flex justify-center items-center py-2.5 px-4 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm bg-white dark:bg-slate-700 text-sm font-medium text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <span className="sr-only">Sign in with Google</span>
                                {socialLoading === 'google' ? (
                                    <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <GoogleIcon/>
                                )}
                            </button>
                            <button 
                                type="button" 
                                onClick={() => handleSocialLogin('twitter')} 
                                disabled={socialLoading !== null}
                                className="w-full inline-flex justify-center items-center py-2.5 px-4 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm bg-white dark:bg-slate-700 text-sm font-medium text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <span className="sr-only">Sign in with Twitter/X</span>
                                {socialLoading === 'twitter' ? (
                                    <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <TwitterIcon/>
                                )}
                            </button>
                            <button 
                                type="button" 
                                onClick={() => handleSocialLogin('facebook')} 
                                disabled={socialLoading !== null}
                                className="w-full inline-flex justify-center items-center py-2.5 px-4 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm bg-white dark:bg-slate-700 text-sm font-medium text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <span className="sr-only">Sign in with Facebook</span>
                                {socialLoading === 'facebook' ? (
                                    <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <FacebookIcon/>
                                )}
                            </button>
                        </div>
                        
                        <p className="mt-4 text-xs text-center text-slate-500 dark:text-slate-400">
                            Social login requires OAuth configuration in Supabase Dashboard
                        </p>
                    </>
                )}

                <div className="mt-8 text-sm text-center">
                    {!isForgotPasswordView && (
                        <button onClick={toggleView} className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500">
                            {isLoginView ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                        </button>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;