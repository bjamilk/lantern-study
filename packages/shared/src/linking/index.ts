// ===========================================
// Lantern Study - Deep Linking Utilities
// ===========================================
// Cross-platform deep linking for web and mobile

export const DEEP_LINK_SCHEME = 'lanternstudy';
export const WEB_BASE_URL = 'https://lanternstudy.app';

export type DeepLinkType = 
    | 'flashcard'
    | 'deck'
    | 'test'
    | 'group'
    | 'profile'
    | 'marketplace'
    | 'budget'
    | 'listing';

export interface DeepLinkParams {
    type: DeepLinkType;
    id: string;
    extra?: Record<string, string>;
}

/**
 * Generate a deep link URL
 * @param params - The deep link parameters
 * @param platform - 'mobile' for app scheme, 'web' for https URL
 */
export const generateDeepLink = (
    params: DeepLinkParams,
    platform: 'mobile' | 'web' | 'universal' = 'universal'
): string => {
    const path = `/${params.type}/${params.id}`;
    const queryString = params.extra 
        ? '?' + new URLSearchParams(params.extra).toString()
        : '';

    switch (platform) {
        case 'mobile':
            return `${DEEP_LINK_SCHEME}:/${path}${queryString}`;
        case 'web':
            return `${WEB_BASE_URL}${path}${queryString}`;
        case 'universal':
        default:
            // Return mobile scheme - the app will handle it, 
            // and web will use universal links
            return `${DEEP_LINK_SCHEME}:/${path}${queryString}`;
    }
};

/**
 * Parse a deep link URL into parameters
 */
export const parseDeepLink = (url: string): DeepLinkParams | null => {
    try {
        // Handle both mobile scheme and web URLs
        let path: string;
        let searchParams: URLSearchParams;

        if (url.startsWith(`${DEEP_LINK_SCHEME}://`)) {
            // Mobile deep link: lanternstudy://flashcard/123
            const withoutScheme = url.replace(`${DEEP_LINK_SCHEME}://`, '');
            const [pathPart = '', queryPart = ''] = withoutScheme.split('?');
            path = pathPart;
            searchParams = new URLSearchParams(queryPart);
        } else if (url.startsWith(`${DEEP_LINK_SCHEME}:/`)) {
            // Alternative format: lanternstudy:/flashcard/123
            const withoutScheme = url.replace(`${DEEP_LINK_SCHEME}:/`, '');
            const [pathPart = '', queryPart = ''] = withoutScheme.split('?');
            path = pathPart;
            searchParams = new URLSearchParams(queryPart);
        } else if (url.startsWith(WEB_BASE_URL)) {
            // Web URL: https://lanternstudy.app/flashcard/123
            const urlObj = new URL(url);
            path = urlObj.pathname.slice(1); // Remove leading /
            searchParams = urlObj.searchParams;
        } else if (url.startsWith('/')) {
            // Relative path: /flashcard/123
            const [pathPart = '', queryPart = ''] = url.slice(1).split('?');
            path = pathPart;
            searchParams = new URLSearchParams(queryPart);
        } else {
            return null;
        }

        const segments = path.split('/').filter(Boolean);
        if (segments.length === 1) {
            const route = segments[0];
            if (route === 'budget' || route === 'marketplace') {
                return { type: route as DeepLinkType, id: '' };
            }
            return null;
        }
        if (segments.length < 2) return null;

        const type = segments[0] as DeepLinkType;
        const id = segments[1] ?? '';

        // Convert searchParams to object
        const extra: Record<string, string> = {};
        searchParams.forEach((value, key) => {
            extra[key] = value;
        });

        return {
            type,
            id,
            extra: Object.keys(extra).length > 0 ? extra : undefined,
        };
    } catch (error) {
        console.error('Failed to parse deep link:', error);
        return null;
    }
};

/**
 * Generate a shareable flashcard link
 */
export const generateFlashcardLink = (flashcardId: string, deckId?: string): string => {
    return generateDeepLink({
        type: 'flashcard',
        id: flashcardId,
        extra: deckId ? { deckId } : undefined,
    });
};

/**
 * Generate a shareable deck link
 */
export const generateDeckLink = (deckId: string): string => {
    return generateDeepLink({
        type: 'deck',
        id: deckId,
    });
};

/**
 * Generate a shareable group link
 */
export const generateGroupLink = (groupId: string, inviteId?: string): string => {
    return generateDeepLink({
        type: 'group',
        id: groupId,
        extra: inviteId ? { invite: inviteId } : undefined,
    });
};

/**
 * Generate a shareable marketplace listing link
 */
export const generateListingLink = (listingId: string): string => {
    return generateDeepLink({
        type: 'listing',
        id: listingId,
    });
};

/**
 * React Navigation linking configuration for mobile
 * Use this in your navigation container
 */
export const getNavigationLinkingConfig = () => ({
    prefixes: [
        `${DEEP_LINK_SCHEME}://`,
        `${DEEP_LINK_SCHEME}:/`,
        WEB_BASE_URL,
    ],
    config: {
        screens: {
            // Auth screens
            Auth: {
                screens: {
                    Login: 'login',
                    SignUp: 'signup',
                    ForgotPassword: 'forgot-password',
                },
            },
            // Main app screens
            Main: {
                screens: {
                    Dashboard: 'dashboard',
                    Flashcards: 'flashcards',
                    FlashcardReview: 'flashcard/:id',
                    DeckDetail: 'deck/:id',
                    Groups: 'groups',
                    GroupDetail: 'group/:id',
                    TestTaking: 'test/:id',
                    Marketplace: 'marketplace',
                    ListingDetail: 'listing/:id',
                    Profile: 'profile/:id',
                    Settings: 'settings',
                },
            },
        },
    },
});
