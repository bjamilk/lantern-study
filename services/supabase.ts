import { createClient } from '@supabase/supabase-js'
import { UserQuestionStats } from '../types'
import { getSupabaseUrl, getSupabaseAnonKey, getApiBaseUrl } from '@lantern/shared'

// Use shared config for URLs
const supabaseUrl = getSupabaseUrl()
const supabaseAnonKey = getSupabaseAnonKey()
const API_BASE_URL = getApiBaseUrl()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      // PostgREST will respond with JSON; include wildcard and object media type
      'Accept': 'application/json, text/plain, */*, application/vnd.pgrst.object+json',
    },
  },
})

// Helper function to fetch with timeout
const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
};

// Helper function to get authenticated headers
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  // Get the current session
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.warn('Error getting session:', error.message);
  }
  
  if (session?.access_token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };
  }
  
  // Try to refresh the session before falling back to localStorage
  try {
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (refreshData?.session?.access_token) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshData.session.access_token}`,
      };
    }
  } catch (e) {
    // refresh failed, continue to fallback
  }
  
  // Fallback: Try to get token from localStorage directly
  // Supabase stores session with key like 'sb-<project-ref>-auth-token'
  if (typeof window !== 'undefined') {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.access_token) {
              return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${parsed.access_token}`,
              };
            }
          }
        } catch (e) {
          // skip invalid entries
        }
      }
    }
    
    // Also check for our custom stored tokens
    const storedAccessToken = localStorage.getItem('lantern_access_token');
    if (storedAccessToken) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${storedAccessToken}`,
      };
    }
  }
  
  console.warn('No session found, proceeding without auth token');
  return {
    'Content-Type': 'application/json',
  };
};

// Helper to check if user has a valid session before making auth-required calls
const hasValidSession = async (): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session?.access_token;
};

// Helper to get the current authenticated user id (or null if not authenticated)
const getAuthenticatedUserId = async (): Promise<string | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
};

// For local development, the keys are default, but in production, set env vars.

export const createGroup = async (groupData: { name: string; description: string; avatar_url?: string; permissions: any; invite_id: string; parent_id?: string }, userId: string, memberIds: string[]) => {
  console.log('Creating group with data:', groupData, 'userId:', userId, 'memberIds:', memberIds);
  
  const response = await fetch(`${API_BASE_URL}/api/v1/groups`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ ...groupData, userId, memberIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create group');
  }

  const result = await response.json();
  console.log('Group created:', result.data);
  return result.data;
};

export const fetchGroups = async (userId: string) => {
  console.log('Fetching groups for user:', userId);
  
  const response = await fetch(`${API_BASE_URL}/api/v1/groups?userId=${userId}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch groups');
  }

  const result = await response.json();
  console.log('Fetched groups count:', result.data.length);
  return result.data.map((item: any) => item);
};

export const fetchGroupMembers = async (groupId: string) => {
  console.log('Fetching members for group:', groupId);
  
  const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}/members`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch group members');
  }

  const result = await response.json();
  console.log('Fetched members count:', result.data.length);
  return result.data;
};

export const addGroupMember = async (groupId: string, userId: string) => {
  console.log('Adding member to group:', groupId, 'userId:', userId);
  
  if (!(await hasValidSession())) {
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (!refreshData?.session) {
      console.warn('No valid session for addGroupMember, skipping API call');
      throw new Error('No valid session. Please log in again.');
    }
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}/members`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to add member to group');
  }

  const result = await response.json();
  console.log('Member added successfully');
  return result.data;
};

export const addGroupMembersBatch = async (groupId: string, userIds: string[]) => {
  console.log('Batch adding members to group:', groupId, 'count:', userIds.length);
  
  // Ensure we have a valid session before making the call
  if (!(await hasValidSession())) {
    // Try to refresh the session
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (!refreshData?.session) {
      console.warn('No valid session for addGroupMembersBatch, skipping API call');
      throw new Error('No valid session. Please log in again.');
    }
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}/members/batch`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ userIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to add members to group');
  }

  const result = await response.json();
  console.log('Batch add result:', result.data);
  return result.data as { added: string[]; alreadyMembers: string[]; failed: string[] };
};

export const joinGroupByInvite = async (inviteId: string) => {
  console.log('Joining group via invite:', inviteId);
  
  const response = await fetch(`${API_BASE_URL}/api/v1/groups/join`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ inviteId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || 'Failed to join group');
  }

  const result = await response.json();
  console.log('Joined group successfully:', result.data?.name);
  return result.data;
};

export const sendMessage = async (groupId: string, userId: string, content: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/group/${groupId}`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ content, userId }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.debug('Auth not ready for sendMessage, returning null');
        return null;
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to send message');
    }

    const result = await response.json();
    return result.data;
  } catch (error: any) {
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for sendMessage');
      return null;
    }
    throw error;
  }
};

export const voteQuestion = async (messageId: string, userId: string, voteType: 'up' | 'down') => {
  console.log('Voting on message:', messageId, 'type:', voteType);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/${messageId}/vote`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        userId,
        voteType,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to vote on question');
    }

    const result = await response.json();
    console.log('Vote recorded:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error voting:', error);
    throw error;
  }
};

export const removeVote = async (messageId: string, userId: string) => {
  console.log('Removing vote on message:', messageId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/${messageId}/vote?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove vote');
    }

    const result = await response.json();
    console.log('Vote removed');
    return result.data;
  } catch (error) {
    console.error('Error removing vote:', error);
    throw error;
  }
};

export const fetchMessages = async (groupId: string) => {
  console.log('Fetching messages for group:', groupId);
  
  const response = await fetch(`${API_BASE_URL}/api/v1/messages/group/${groupId}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch messages');
  }

  const result = await response.json();
  console.log('Fetched messages count:', result.data.length);
  return result.data;
};

export const fetchUserVotesForGroup = async (groupId: string, userId: string): Promise<Record<string, 'up' | 'down'>> => {
  console.log('Fetching user votes for group:', groupId, 'userId:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/group/${groupId}/user-votes?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user votes');
    }

    const result = await response.json();
    console.log('Fetched user votes:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching user votes:', error);
    return {}; // Return empty object on error
  }
};

export const updateMessage = async (messageId: string, updates: { flagged_as_similar_user_ids?: string[] }) => {
  console.log('Updating message:', messageId, 'updates:', updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/${messageId}/update`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        flaggedUserIds: updates.flagged_as_similar_user_ids,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update message');
    }

    const result = await response.json();
    console.log('Message updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
};

export const updateQuestionStatus = async (messageId: string, questionStatus: string) => {
  console.log('Updating question status:', messageId, 'to:', questionStatus);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/${messageId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ questionStatus }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update question status');
    }

    const result = await response.json();
    console.log('Question status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating question status:', error);
    throw error;
  }
};

// --- Flashcard Functions ---

export const createDeck = async (deckData: { name: string; description?: string; isShared?: boolean }, userId: string) => {
  console.log('Creating deck:', deckData.name, 'isShared:', deckData.isShared);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: deckData.name,
        description: deckData.description,
        isShared: deckData.isShared,
        userId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create deck');
    }

    const result = await response.json();
    console.log('Deck created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating deck:', error);
    throw error;
  }
};

export const fetchDecks = async (userId: string, options?: { includeShared?: boolean }) => {
  const includeShared = options?.includeShared ?? false;
  console.log('Fetching decks for user:', userId, 'includeShared:', includeShared);
  try {
    const params = new URLSearchParams();
    params.set('userId', userId);
    if (includeShared) params.set('includeShared', 'true');

    const response = await fetch(`${API_BASE_URL}/api/v1/decks?${params.toString()}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch decks');
    }

    const result = await response.json();
    console.log('Fetched decks count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching decks:', error);
    throw error;
  }
};

export const updateDeck = async (deckId: string, updates: { name?: string; description?: string; isShared?: boolean }) => {
  console.log('Updating deck:', deckId, 'updates:', updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update deck');
    }

    const result = await response.json();
    console.log('Deck updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating deck:', error);
    throw error;
  }
};

export const fetchUsers = async (search?: string, options?: { page?: number; limit?: number }) => {
  console.log('Fetching users', 'search:', search);
  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(options?.page ?? 1));
    params.set('limit', String(options?.limit ?? 20));

    const response = await fetch(`${API_BASE_URL}/api/v1/users?${params.toString()}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch users');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

export const fetchDeckCollaborators = async (deckId: string) => {
  console.log('Fetching collaborators for deck:', deckId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}/collaborators`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch deck collaborators');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching deck collaborators:', error);
    throw error;
  }
};

export const addDeckCollaborator = async (deckId: string, userId: string, role: string = 'editor') => {
  console.log('Adding collaborator to deck:', deckId, userId, role);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}/collaborators`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, role }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add collaborator');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error adding deck collaborator:', error);
    throw error;
  }
};

export const removeDeckCollaborator = async (deckId: string, userId: string) => {
  console.log('Removing collaborator from deck:', deckId, userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}/collaborators/${userId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove collaborator');
    }

    return true;
  } catch (error) {
    console.error('Error removing deck collaborator:', error);
    throw error;
  }
};

export const fetchStudySessions = async (deckId: string) => {
  console.log('Fetching study sessions for deck:', deckId);
  try {
    const params = new URLSearchParams();
    params.set('deckId', deckId);

    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions?${params.toString()}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch study sessions');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching study sessions:', error);
    throw error;
  }
};

export const createStudySession = async (deckId: string, userId: string, endsAt?: string, metadata?: any) => {
  console.log('Creating study session for deck:', deckId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ deckId, userId, endsAt, metadata }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create study session');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating study session:', error);
    throw error;
  }
};

export const joinStudySession = async (sessionId: string, userId: string) => {
  console.log('Joining study session:', sessionId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions/${sessionId}/join`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to join study session');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error joining study session:', error);
    throw error;
  }
};

export const leaveStudySession = async (sessionId: string, userId: string) => {
  console.log('Leaving study session:', sessionId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions/${sessionId}/leave`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to leave study session');
    }

    return true;
  } catch (error) {
    console.error('Error leaving study session:', error);
    throw error;
  }
};

export const endStudySession = async (sessionId: string) => {
  console.log('Ending study session:', sessionId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions/${sessionId}/end`, {
      method: 'POST',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to end study session');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error ending study session:', error);
    throw error;
  }
};

export const getStudySession = async (sessionId: string) => {
  console.log('Getting study session:', sessionId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/study-sessions/${sessionId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch study session');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching study session:', error);
    throw error;
  }
};

export const deleteDeck = async (deckId: string) => {
  console.log('Deleting deck:', deckId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete deck');
    }

    console.log('Deck deleted');
  } catch (error) {
    console.error('Error deleting deck:', error);
    throw error;
  }
};

export const createFlashcard = async (flashcardData: {
  deckId: string;
  type: string;
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: any;
  srsData?: any;
  tags?: string[];
}) => {
  console.log('Creating flashcard for deck:', flashcardData.deckId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        deckId: flashcardData.deckId,
        type: flashcardData.type || 'BASIC',
        front: flashcardData.front,
        back: flashcardData.back,
        clozeText: flashcardData.clozeText,
        imageUrl: flashcardData.imageUrl,
        occlusionData: flashcardData.occlusionData,
        tags: flashcardData.tags,
        userId: 'test-user', // This should be passed in or retrieved from context
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create flashcard');
    }

    const result = await response.json();
    console.log('Flashcard created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating flashcard:', error.message || JSON.stringify(error));
    throw error;
  }
};

export const fetchFlashcardComments = async (flashcardId: string) => {
  console.log('Fetching comments for flashcard:', flashcardId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards/${flashcardId}/comments`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch flashcard comments');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching flashcard comments:', error);
    throw error;
  }
};

export const addFlashcardComment = async (flashcardId: string, userId: string, comment: string) => {
  console.log('Adding comment to flashcard:', flashcardId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards/${flashcardId}/comments`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, comment }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add comment');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error adding flashcard comment:', error);
    throw error;
  }
};

export const fetchFlashcards = async (
  deckId?: string,
  userId?: string,
  options?: { page?: number; limit?: number }
) => {
  console.log('Fetching flashcards', deckId ? `for deck: ${deckId}` : 'for all decks', userId ? `for user: ${userId}` : '');
  try {
    const params = new URLSearchParams();

    if (deckId) {
      params.append('deckId', deckId);
    }

    if (userId) params.append('userId', userId);

    // default to a large page size so UI can show all cards in deck without requiring paging
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 1000;
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const url = `${API_BASE_URL}/api/v1/flashcards?${params.toString()}`;
    console.log('Fetching flashcards URL:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch flashcards');
    }

    const result = await response.json();
    console.log('Fetched flashcards count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching flashcards:', error);
    throw error;
  }
};

export const updateFlashcard = async (flashcardId: string, updates: {
  deckId?: string;
  type?: string;
  front?: string;
  back?: string;
  clozeText?: string;
  imageUrl?: string;
  occlusionData?: any;
  srsData?: any;
  tags?: string[];
}) => {
  console.log('Updating flashcard:', flashcardId, 'updates:', updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards/${flashcardId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        front: updates.front,
        back: updates.back,
        clozeText: updates.clozeText,
        imageUrl: updates.imageUrl,
        occlusionData: updates.occlusionData,
        srsData: updates.srsData,
        tags: updates.tags,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update flashcard');
    }

    const result = await response.json();
    console.log('Flashcard updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating flashcard:', error.message || JSON.stringify(error));
    throw error;
  }
};

export const deleteFlashcard = async (flashcardId: string) => {
  console.log('Deleting flashcard:', flashcardId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards/${flashcardId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete flashcard');
    }

    console.log('Flashcard deleted');
  } catch (error) {
    console.error('Error deleting flashcard:', error);
    throw error;
  }
};

// Reset SRS statistics for all flashcards in a deck
export const resetDeckStatistics = async (deckId: string, userId?: string) => {
  console.log('Resetting SRS statistics for deck:', deckId, userId ? `(user ${userId})` : '');
  try {
    const body: any = {};
    if (userId) body.userId = userId;

    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}/reset`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to reset deck statistics');
    }

    const result = await response.json();
    console.log('Deck statistics reset');
    return result.data;
  } catch (error) {
    console.error('Error resetting deck statistics:', error);
    throw error;
  }
};

// Export deck with all flashcards
export const exportDeck = async (deckId: string) => {
  console.log('Exporting deck:', deckId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/${deckId}/export`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to export deck');
    }

    const result = await response.json();
    console.log('Deck exported successfully');
    return result.data;
  } catch (error) {
    console.error('Error exporting deck:', error);
    throw error;
  }
};

// Import deck from export data
// Returns an object containing the new deck and an array of the flashcards
// that were inserted (so the client can update state without an extra fetch).
export const importDeck = async (importData: any, userId: string): Promise<{deck: any; flashcards: any[]}> => {
  console.log('Importing deck for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/decks/import`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        importData,
        userId,
      }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to import deck';
      try {
        const error = await response.json();
        errorMessage = error.message || error.error || errorMessage;
      } catch {
        errorMessage = `Server error (${response.status})`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('Deck imported successfully', result.data);
    return result.data; // { deck: ..., flashcards: [...] }
  } catch (error) {
    console.error('Error importing deck:', error);
    throw error;
  }
};

// --- Test Sessions and Results ---

export const createTestSession = async (sessionData: {
  config: any;
  questions: any[];
  user_answers: Record<string, any>;
  start_time: string;
  end_time?: string;
  is_offline: boolean;
}, userId: string) => {
  console.log('Creating test session for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/tests`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        ...sessionData,
        userId
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Test session created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating test session:', error);
    throw error;
  }
};

export const updateTestSession = async (sessionId: string, updates: {
  user_answers?: Record<string, any>;
  end_time?: string;
}, userId: string) => {
  console.log('Updating test session:', sessionId, 'updates:', updates, 'user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/tests/${sessionId}/submit`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        answers: updates.user_answers ? Object.values(updates.user_answers) : [],
        userId
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Test session updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating test session:', error);
    throw error;
  }
};

export const createTestResult = async (resultData: {
  session_id: string;
  score: number;
  correct_answers_count: number;
  total_questions: number;
}) => {
  console.log('Creating test result for session:', resultData.session_id);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/tests/${resultData.session_id}/results`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        score: resultData.score,
        correctAnswersCount: resultData.correct_answers_count,
        totalQuestions: resultData.total_questions,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Test result created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating test result:', error);
    throw error;
  }
};

export const fetchTestResults = async (userId: string) => {
  console.log('Fetching test results for user:', userId);
  try {
    // This might need to be adjusted based on what the API returns
    // For now, assuming we get test sessions with results
    const response = await fetch(`${API_BASE_URL}/api/v1/tests?userId=${encodeURIComponent(userId)}&status=completed`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Fetched test results count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching test results:', error);
    throw error;
  }
};

// --- User Question Stats ---

export const upsertUserQuestionStat = async (userId: string, questionId: string, stat: {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
}) => {
  console.log('Upserting user question stat for user:', userId, 'question:', questionId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        questionId,
        correctAttempts: stat.correctAttempts,
        incorrectAttempts: stat.incorrectAttempts,
        lastAttempted: stat.lastAttempted,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to upsert user question stat');
    }

    const result = await response.json();
    console.log('User question stat upserted:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error upserting user question stat:', error);
    throw error;
  }
};

export const fetchUserQuestionStats = async (userId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/user-stats/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 401 || response.status === 403) {
      console.debug('Auth not ready for user-stats, returning empty');
      return {} as UserQuestionStats;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const stats: UserQuestionStats = {};
    if (result.data && Array.isArray(result.data)) {
      result.data.forEach((stat: any) => {
        stats[stat.question_id] = {
          correctAttempts: stat.correct_attempts || 0,
          incorrectAttempts: stat.incorrect_attempts || 0,
          lastAttempted: stat.last_attempted || null
        };
      });
    }
    return stats;
  } catch (error: any) {
    // Network errors (server not running) - return empty silently
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for user-stats, returning empty');
      return {} as UserQuestionStats;
    }
    console.error('Error fetching user question stats:', error);
    throw error;
  }
};

// --- Profile/User Functions ---

export const fetchUserProfile = async (userId: string) => {
  console.log('Fetching user profile for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Fetched user profile:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
};

export const updateUserProfile = async (userId: string, updates: {
  name?: string;
  avatar_url?: string;
  phone?: string;
  points?: number;
  stats?: any;
  badges?: any[];
  settings?: any;
  test_presets?: any[];
}) => {
  console.log('Updating user profile for user:', userId, 'updates:', updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('User profile updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
};

export const createUserProfile = async (profileData: {
  id: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  points?: number;
  stats?: any;
  badges?: any[];
  settings?: any;
  test_presets?: any[];
}) => {
  console.log('Creating user profile:', profileData);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(profileData),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('User profile created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating user profile:', error);
    throw error;
  }
};

export const deleteUserAccount = async (userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) {
      console.error('Error deleting user account:', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting user account:', error);
    return false;
  }
};

// --- Notification Functions ---

export const createNotification = async (notificationData: {
  user_id: string;
  message: string;
  link?: string;
}) => {
  console.log('Creating notification for user:', notificationData.user_id);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        userId: notificationData.user_id,
        message: notificationData.message,
        link: notificationData.link,
        type: 'info'
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Notification created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

export const fetchNotifications = async (userId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (response.status === 401 || response.status === 403) {
      console.debug('Auth not ready for notifications, returning empty');
      return [];
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return result.data.map((notification: any) => ({
      id: notification.id,
      message: notification.message,
      date: notification.date,
      read: notification.read,
      link: notification.link
    }));
  } catch (error: any) {
    // Network errors (server not running) - return empty silently
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      console.debug('API server unreachable for notifications, returning empty');
      return [];
    }
    console.error('Error fetching notifications:', error);
    throw error;
  }
};

export const markNotificationAsRead = async (notificationId: string, userId: string) => {
  console.log('Marking notification as read:', notificationId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}/read?userId=${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Notification marked as read:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

export const markAllNotificationsAsRead = async (userId: string) => {
  console.log('Marking all notifications as read for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications/read-all?userId=${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Marked notifications as read count:', result.data.updatedCount);
    return result.data.updatedCount;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

export const deleteNotification = async (notificationId: string) => {
  console.log('Deleting notification:', notificationId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}?userId=test-user`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log('Notification deleted');
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
};

export const deleteAllNotifications = async (userId: string) => {
  console.log('Deleting all notifications for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/notifications?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete all notifications');
    }

    const result = await response.json();
    console.log('All notifications deleted:', result.data);
    return result.data.deletedCount;
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    throw error;
  }
};

export const deleteGroup = async (groupId: string) => {
  console.log('Deleting group:', groupId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete group');
    }

    console.log('Group deleted successfully');
  } catch (error) {
    console.error('Error deleting group:', error);
    throw error;
  }
};

export const updateGroup = async (groupId: string, updates: { name?: string; description?: string; isArchived?: boolean; avatarUrl?: string }) => {
  console.log('Updating group:', groupId, 'updates:', updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        isArchived: updates.isArchived,
        avatarUrl: updates.avatarUrl
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update group');
    }

    const result = await response.json();
    console.log('Group updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating group:', error);
    throw error;
  }
};

// --- Marketplace Functions ---

export const createMarketplaceListing = async (listingData: {
  category: string;
  title: string;
  description?: string;
  price?: number;
  location?: string;
  images?: string[];
  categorySpecificFields?: any;
}) => {
  console.log('Creating marketplace listing:', listingData.title);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(listingData),
    });

    // Try to parse response as JSON
    const contentType = response.headers.get('content-type');
    let result;
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const text = await response.text();
      console.error('Non-JSON response:', text);
      throw new Error('Server returned non-JSON response');
    }

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to create listing');
    }

    console.log('Listing created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating listing:', error);
    throw error;
  }
};

export const fetchMarketplaceListings = async (filters: {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
} = {}) => {
  console.log('Fetching marketplace listings', filters);
  try {
    const queryParams = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value.toString());
      }
    });

    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/listings?${queryParams}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch listings');
    }

    const result = await response.json();
    console.log('Fetched listings count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching listings:', error);
    return []; // Return empty array on error instead of throwing
  }
};

export const fetchMarketplaceListing = async (listingId: string) => {
  console.log('Fetching marketplace listing:', listingId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      // 404 is expected for deleted/missing listings, especially in "recently viewed".
      if (response.status === 404) {
        return null;
      }

      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch listing');
    }

    const result = await response.json();
    console.log('Fetched listing:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching listing:', error);
    throw error;
  }
};

export const updateMarketplaceListing = async (listingId: string, updates: any) => {
  console.log('Updating marketplace listing:', listingId, updates);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update listing');
    }

    const result = await response.json();
    console.log('Listing updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating listing:', error);
    throw error;
  }
};

export const deleteMarketplaceListing = async (listingId: string) => {
  console.log('Deleting marketplace listing:', listingId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete listing');
    }

    console.log('Listing deleted');
  } catch (error) {
    console.error('Error deleting listing:', error);
    throw error;
  }
};

export const addMarketplaceReview = async (listingId: string, review: { rating: number; comment?: string }) => {
  console.log('Adding review to listing:', listingId, review);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}/reviews`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(review),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add review');
    }

    const result = await response.json();
    console.log('Review added:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error adding review:', error);
    throw error;
  }
};

export const reportMarketplaceListing = async (listingId: string, report: { reason: string; details?: string }) => {
  console.log('Reporting listing:', listingId, report);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}/reports`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(report),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to report listing');
    }

    const result = await response.json();
    console.log('Report submitted:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error reporting listing:', error);
    throw error;
  }
};

export const initiateMarketplaceTransaction = async (listingId: string, amount: number) => {
  console.log('Initiating transaction for listing:', listingId, amount);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/transactions`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, amount }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to initiate transaction');
    }

    const result = await response.json();
    console.log('Transaction initiated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error initiating transaction:', error);
    throw error;
  }
};

// ============ SELLER DASHBOARD FUNCTIONS ============

export const fetchMyListings = async (status?: string, userId?: string) => {
  console.log('Fetching my listings', { status, userId });
  try {
    const queryParams = new URLSearchParams();
    if (status) queryParams.append('status', status);
    if (userId) queryParams.append('userId', userId);
    
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/my-listings?${queryParams}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch listings');
    }

    const result = await response.json();
    console.log('Fetched my listings:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching my listings:', error);
    return []; // Return empty array on error
  }
};

export const fetchSellerStats = async (userId?: string) => {
  console.log('Fetching seller stats', { userId });
  try {
    const queryParams = new URLSearchParams();
    if (userId) queryParams.append('userId', userId);
    
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/stats?${queryParams}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch stats');
    }

    const result = await response.json();
    console.log('Fetched seller stats:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error fetching seller stats:', error);
    return null; // Return null on error
  }
};

export const updateListingStatus = async (listingId: string, status: 'active' | 'inactive' | 'sold') => {
  console.log('Updating listing status:', listingId, status);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update status');
    }

    const result = await response.json();
    console.log('Status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating listing status:', error);
    throw error;
  }
};

// ============ FAVORITES FUNCTIONS ============

export const fetchMyFavorites = async () => {
  try {
    if (!(await hasValidSession())) return [];
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/favorites`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch favorites');
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return []; // Return empty array on error
  }
};

export const addToFavorites = async (listingId: string) => {
  console.log('Adding to favorites:', listingId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/favorites`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to add to favorites');
    }

    const result = await response.json();
    console.log('Added to favorites:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error adding to favorites:', error);
    throw error;
  }
};

export const removeFromFavorites = async (listingId: string) => {
  console.log('Removing from favorites:', listingId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/favorites/${listingId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to remove from favorites');
    }

    console.log('Removed from favorites');
  } catch (error) {
    console.error('Error removing from favorites:', error);
    throw error;
  }
};

export const checkIfFavorited = async (listingId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/favorites/${listingId}/check`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) return false;

    const result = await response.json();
    return result.data.isFavorited;
  } catch (error) {
    console.error('Error checking favorite:', error);
    return false;
  }
};

// ============ INQUIRY FUNCTIONS ============

export const fetchMyInquiries = async (role: 'seller' | 'buyer' = 'seller', status?: string) => {
  console.log('Fetching my inquiries', { role, status });
  try {
    const queryParams = new URLSearchParams({ role });
    if (status) queryParams.append('status', status);
    
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/inquiries?${queryParams}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch inquiries');
    }

    const result = await response.json();
    console.log('Fetched inquiries:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    throw error;
  }
};

export const createInquiry = async (listingId: string, message: string) => {
  console.log('Creating inquiry for listing:', listingId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/inquiries`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, message }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create inquiry');
    }

    const result = await response.json();
    console.log('Inquiry created:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error creating inquiry:', error);
    throw error;
  }
};

export const updateInquiryStatus = async (inquiryId: string, status: 'open' | 'negotiating' | 'closed' | 'purchased') => {
  console.log('Updating inquiry status:', inquiryId, status);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/inquiries/${inquiryId}/status`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update inquiry status');
    }

    const result = await response.json();
    console.log('Inquiry status updated:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error updating inquiry status:', error);
    throw error;
  }
};

export const getInquiryByThread = async (threadId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/inquiries/thread/${threadId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching inquiry by thread:', error);
    return null;
  }
};

// --- Marketplace Offers ---

export const createOffer = async (listingId: string, amount: number, message?: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/offers`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ listingId, amount, message }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to create offer');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating offer:', error);
    throw error;
  }
};

export const respondToOffer = async (offerId: string, action: 'accept' | 'decline' | 'counter' | 'withdraw', counterAmount?: number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/offers/${offerId}`, {
      method: 'PUT',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ action, counterAmount }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to respond to offer');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error responding to offer:', error);
    throw error;
  }
};

export const fetchOffers = async (role: 'buyer' | 'seller') => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/offers?role=${role}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching offers:', error);
    return [];
  }
};

export const fetchOffersForListing = async (listingId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}/offers`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching offers for listing:', error);
    return [];
  }
};

// --- Saved Searches ---

export const saveSearch = async (filters: Record<string, any>, name?: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/saved-searches`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ filters, name }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to save search');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error saving search:', error);
    throw error;
  }
};

export const fetchSavedSearches = async () => {
  try {
    if (!(await hasValidSession())) return [];
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/saved-searches`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching saved searches:', error);
    return [];
  }
};

export const deleteSavedSearch = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/saved-searches/${id}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete saved search');
  } catch (error) {
    console.error('Error deleting saved search:', error);
    throw error;
  }
};

export const checkSavedSearchMatches = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/saved-searches/${id}/matches`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) return { count: 0, listings: [] };
    const result = await response.json();
    return result.data || { count: 0, listings: [] };
  } catch (error) {
    console.error('Error checking saved search matches:', error);
    return { count: 0, listings: [] };
  }
};

// --- Custom Categories ---

export const fetchCustomCategories = async () => {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/categories/custom`, {
      method: 'GET',
    }, 5000);
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching custom categories:', error);
    return [];
  }
};

export const createCustomCategory = async (name: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/marketplace/categories/custom`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create category');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error creating custom category:', error);
    throw error;
  }
};

// --- Similar Listings ---

export const fetchSimilarListings = async (listingId: string) => {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/listings/${listingId}/similar`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching similar listings:', error);
    return [];
  }
};

// --- Seller Profile ---

export const fetchSellerProfile = async (userId: string) => {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/marketplace/sellers/${userId}/profile`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    }, 5000);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to load seller profile');
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error fetching seller profile:', error);
    throw error;
  }
};

// --- Recently Viewed (localStorage) ---

const RECENTLY_VIEWED_KEY = 'lantern_recently_viewed';
const MAX_RECENTLY_VIEWED = 20;

export const addRecentlyViewed = (listingId: string) => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    let ids: string[] = stored ? JSON.parse(stored) : [];
    ids = ids.filter(id => id !== listingId);
    ids.unshift(listingId);
    ids = ids.slice(0, MAX_RECENTLY_VIEWED);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error('Error saving recently viewed:', error);
  }
};

export const getRecentlyViewed = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const clearRecentlyViewed = () => {
  localStorage.removeItem(RECENTLY_VIEWED_KEY);
};

export const removeRecentlyViewed = (listingIds: string[]) => {
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!stored) return;
    const ids: string[] = JSON.parse(stored);
    const filtered = ids.filter((id) => !listingIds.includes(id));
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing recently viewed listings:', error);
  }
};

// --- File Upload Functions ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.substring(commaIndex + 1) : result);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

export const uploadFlashcardImage = async (file: File) => {
  console.log('Uploading flashcard image:', file.name);
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

    const base64Data = await fileToBase64(file);

    const response = await fetch(`${API_BASE_URL}/api/v1/flashcards/upload-image`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        fileName,
        base64Data,
        contentType: file.type,
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const bodyText = await response.text();
      let message = `Upload failed (${response.status})`;

      if (contentType.includes('application/json')) {
        try {
          const errorJson = JSON.parse(bodyText);
          message = errorJson.message || errorJson.error || message;
        } catch {
          // ignore parse errors
        }
      } else {
        message = bodyText || message;
      }

      throw new Error(message);
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('Error uploading flashcard image (API_BASE_URL=' + API_BASE_URL + '):', error);
    throw error;
  }
};

export const uploadMarketplaceImage = async (file: File, listingId?: string) => {
  console.log('Uploading marketplace image:', file.name);
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = listingId ? `listings/${listingId}/${fileName}` : `temp/${fileName}`;

    const { data, error } = await supabase.storage
      .from('marketplace-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('marketplace-images')
      .getPublicUrl(filePath);

    console.log('Image uploaded successfully:', publicUrl);
    return { url: publicUrl, path: filePath };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

export const deleteMarketplaceImage = async (filePath: string) => {
  console.log('Deleting marketplace image:', filePath);
  try {
    const { error } = await supabase.storage
      .from('marketplace-images')
      .remove([filePath]);

    if (error) {
      throw new Error(error.message);
    }

    console.log('Image deleted successfully');
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};

// --- Direct Message Functions ---

export const fetchDirectMessages = async (userId: string, otherUserId: string, options: { page?: number; limit?: number } = {}) => {
  console.log('Fetching direct messages between:', userId, 'and:', otherUserId);
  try {
    const { page = 1, limit = 50 } = options;
    const queryParams = new URLSearchParams({
      otherUserId,
      page: page.toString(),
      limit: limit.toString(),
    });
    
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/user/${userId}?${queryParams}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch direct messages');
    }

    const result = await response.json();
    console.log('Fetched direct messages count:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Error fetching direct messages:', error);
    throw error;
  }
};

export const fetchDmThreads = async (userId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/threads?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch DM threads');
    }

    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching DM threads:', error);
    return [];
  }
};

export const sendDirectMessage = async (senderId: string, recipientId: string, content: string) => {
  console.log('Sending direct message from:', senderId, 'to:', recipientId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/user/${senderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        recipientId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send direct message');
    }

    const result = await response.json();
    console.log('Direct message sent:', result.data);
    return result.data;
  } catch (error) {
    console.error('Error sending direct message:', error);
    throw error;
  }
};

// Fetch unread counts for all groups
export const fetchGroupUnreadCounts = async (userId: string): Promise<Record<string, number>> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/unread/all?userId=${userId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      console.error('Failed to fetch group unread counts');
      return {};
    }

    const result = await response.json();
    return result.data || {};
  } catch (error) {
    console.error('Error fetching group unread counts:', error);
    return {};
  }
};

// Mark a group as read
export const markGroupAsRead = async (groupId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${groupId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error('Failed to mark group as read');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking group as read:', error);
    return false;
  }
};

// Fetch unread counts for all DM threads
export const fetchDMUnreadCounts = async (userId: string): Promise<Record<string, number>> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/unread/all?userId=${userId}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      console.error('Failed to fetch DM unread counts');
      return {};
    }

    const result = await response.json();
    return result.data || {};
  } catch (error) {
    console.error('Error fetching DM unread counts:', error);
    return {};
  }
};

// Mark a DM thread as read
export const markDMAsRead = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/${threadId}/read`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error('Failed to mark DM as read');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking DM as read:', error);
    return false;
  }
};

// Delete a DM thread
export const deleteDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/${threadId}?userId=${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('Failed to delete DM thread');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting DM thread:', error);
    return false;
  }
};

// Archive a DM thread
export const archiveDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/${threadId}/archive?userId=${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('Failed to archive DM thread');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error archiving DM thread:', error);
    return false;
  }
};

// Unarchive a DM thread
export const unarchiveDmThread = async (threadId: string, userId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/messages/dm/${threadId}/unarchive?userId=${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error('Failed to unarchive DM thread');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error unarchiving DM thread:', error);
    return false;
  }
};

// ============ OFFLINE BUNDLES SYNC FUNCTIONS ============

export interface OfflineBundleData {
  bundleId: string;
  config: any;
  questions: any[];
  groupName: string;
  downloadedAt: Date;
}

// Fetch offline bundles from server

export const fetchOfflineBundles = async (userId: string): Promise<OfflineBundleData[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/offline-bundles?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return (result.data || []).map((item: any) => ({
      bundleId: item.bundle_id,
      config: item.config,
      questions: item.questions,
      groupName: item.group_name,
      downloadedAt: new Date(item.downloaded_at),
    }));
  } catch (error) {
    console.error('Error fetching offline bundles:', error);
    return [];
  }
};

// Save offline bundle to server

export const saveOfflineBundle = async (userId: string, bundle: OfflineBundleData): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/offline-bundles`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ userId, bundle: {
        ...bundle,
        downloadedAt: bundle.downloadedAt instanceof Date ? bundle.downloadedAt.toISOString() : bundle.downloadedAt,
      } }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return true;
  } catch (error) {
    console.error('Error saving offline bundle:', error);
    return false;
  }
};

// Delete offline bundle from server

export const deleteOfflineBundle = async (userId: string, bundleId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/offline-bundles?userId=${encodeURIComponent(userId)}&bundleId=${encodeURIComponent(bundleId)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return true;
  } catch (error) {
    console.error('Error deleting offline bundle:', error);
    return false;
  }
};

// Sync local offline bundles with server (merge strategy)
export const syncOfflineBundles = async (
  userId: string, 
  localBundles: OfflineBundleData[]
): Promise<OfflineBundleData[]> => {
  try {
    // Fetch server bundles
    const serverBundles = await fetchOfflineBundles(userId);
    
    // Create a map for easy lookup
    const serverBundleMap = new Map(serverBundles.map(b => [b.bundleId, b]));
    const localBundleMap = new Map(localBundles.map(b => [b.bundleId, b]));
    
    // Merge: keep all unique bundles from both sources
    const mergedBundles: OfflineBundleData[] = [];
    const processedIds = new Set<string>();
    
    // Add all local bundles and sync to server if not there
    for (const localBundle of localBundles) {
      mergedBundles.push(localBundle);
      processedIds.add(localBundle.bundleId);
      
      if (!serverBundleMap.has(localBundle.bundleId)) {
        // Upload to server
        await saveOfflineBundle(userId, localBundle);
      }
    }
    
    // Add server bundles that aren't local
    for (const serverBundle of serverBundles) {
      if (!processedIds.has(serverBundle.bundleId)) {
        mergedBundles.push(serverBundle);
        processedIds.add(serverBundle.bundleId);
      }
    }
    
    return mergedBundles;
  } catch (error) {
    console.error('Error syncing offline bundles:', error);
    return localBundles; // Return local bundles on error
  }
};

// ============================================
// USER PREFERENCES SYNC (Theme, Settings)
// ============================================

export interface UserPreferences {
  theme: 'light' | 'dark';
  preferences?: Record<string, any>;
}

export const fetchUserPreferences = async (userId: string): Promise<UserPreferences | null> => {
  console.log('Fetching user preferences for user:', userId);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/preferences/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No preferences found
      }
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch user preferences');
    }

    const result = await response.json();
    const data = result.data;

    return data ? {
      theme: data.theme || 'light',
      preferences: data.preferences || {}
    } : null;
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
};

export const saveUserPreferences = async (userId: string, prefs: UserPreferences): Promise<boolean> => {
  console.log('Saving user preferences for user:', userId, 'prefs:', prefs);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/preferences`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        userId,
        theme: prefs.theme,
        preferences: prefs.preferences || {},
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Error saving user preferences:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }
};

// ============================================
// BUDGET SYNC (Monthly Budget & Transactions)
// ============================================

export interface BudgetData {
  monthlyLimit: number;
  monthYear: string; // Format: "YYYY-MM"
}

export interface TransactionData {
  id: string;
  type: 'INCOME' | 'EXPENSE' | 'INVESTMENT' | string; // Accepts uppercase from app, converts to lowercase for DB
  amount: number;
  category?: string;
  description?: string;
  date: string;
}

export const fetchUserBudget = async (userId: string, monthYear?: string): Promise<BudgetData | null> => {
  try {
    const targetMonth = monthYear || new Date().toISOString().slice(0, 7); // "YYYY-MM"
    
    const { data, error } = await supabase
      .from('user_budgets')
      .select('*')
      .eq('user_id', userId)
      .eq('month_year', targetMonth)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user budget:', error);
      return null;
    }

    return data ? {
      monthlyLimit: parseFloat(data.monthly_limit) || 0,
      monthYear: data.month_year
    } : null;
  } catch (error) {
    console.error('Error fetching user budget:', error);
    return null;
  }
};

export const saveUserBudget = async (userId: string, budget: BudgetData): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('user_budgets')
      .upsert({
        user_id: userId,
        monthly_limit: budget.monthlyLimit,
        month_year: budget.monthYear,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,month_year'
      });

    if (error) {
      console.error('Error saving user budget:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving user budget:', error);
    return false;
  }
};

export const fetchBudgetTransactions = async (userId: string): Promise<TransactionData[]> => {
  try {
    if (!userId || !(await hasValidSession())) {
      console.warn('No valid session available for fetching budget transactions.');
      return [];
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('Unable to determine authenticated user ID for budget transactions.');
      return [];
    }

    if (authUserId !== userId) {
      console.warn('Budget transaction fetch userId does not match authenticated user; using authenticated user id.', {
        requested: userId,
        authenticated: authUserId,
      });
    }

    const { data, error } = await supabase
      .from('budget_transactions')
      .select('*')
      .eq('user_id', authUserId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching budget transactions:', error);
      return [];
    }

    return (data || []).map(t => ({
      id: t.id,
      type: t.type.toUpperCase() as 'INCOME' | 'EXPENSE' | 'INVESTMENT',
      amount: parseFloat(t.amount),
      category: t.category,
      description: t.description,
      date: t.date
    }));
  } catch (error) {
    console.error('Error fetching budget transactions:', error);
    return [];
  }
};

export const saveBudgetTransaction = async (userId: string, transaction: TransactionData): Promise<boolean> => {
  try {
    if (!userId || !(await hasValidSession())) {
      console.warn('No valid session available for saving budget transaction.');
      return false;
    }

    const authUserId = await getAuthenticatedUserId();
    if (!authUserId) {
      console.warn('Unable to determine authenticated user ID for saving budget transaction.');
      return false;
    }

    if (authUserId !== userId) {
      console.warn('Budget transaction save userId does not match authenticated user; using authenticated user id.', {
        requested: userId,
        authenticated: authUserId,
      });
    }

    // Convert type to lowercase to match database constraint ('income', 'expense', 'investment')
    const dbType = transaction.type.toLowerCase();
    
    const { error } = await supabase
      .from('budget_transactions')
      .upsert({
        id: transaction.id,
        user_id: authUserId,
        type: dbType,
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description,
        date: transaction.date
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error saving budget transaction:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving budget transaction:', error);
    return false;
  }
};

export const deleteBudgetTransaction = async (transactionId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('budget_transactions')
      .delete()
      .eq('id', transactionId);

    if (error) {
      console.error('Error deleting budget transaction:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting budget transaction:', error);
    return false;
  }
};

export const syncBudgetTransactionsToCloud = async (
  userId: string,
  localTransactions: TransactionData[]
): Promise<TransactionData[]> => {
  try {
    // Fetch server transactions
    const serverTransactions = await fetchBudgetTransactions(userId);
    const serverTransactionMap = new Map(serverTransactions.map(t => [t.id, t]));
    
    const mergedTransactions: TransactionData[] = [];
    const processedIds = new Set<string>();
    
    // Process local transactions
    for (const localTransaction of localTransactions) {
      mergedTransactions.push(localTransaction);
      processedIds.add(localTransaction.id);
      
      if (!serverTransactionMap.has(localTransaction.id)) {
        // Upload to server
        await saveBudgetTransaction(userId, localTransaction);
      }
    }
    
    // Add server transactions that aren't local
    for (const serverTransaction of serverTransactions) {
      if (!processedIds.has(serverTransaction.id)) {
        mergedTransactions.push(serverTransaction);
        processedIds.add(serverTransaction.id);
      }
    }
    
    // Sort by date descending
    mergedTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return mergedTransactions;
  } catch (error) {
    console.error('Error syncing budget transactions:', error);
    return localTransactions;
  }
};

// ============================================
// PENDING SYNC RESULTS (Offline Test Results)
// ============================================

export interface PendingSyncResult {
  id: string;
  resultData: any;
  createdAt: string;
  synced: boolean;
}

export const fetchPendingSyncResults = async (userId: string): Promise<PendingSyncResult[]> => {
  try {
    const { data, error } = await supabase
      .from('pending_sync_results')
      .select('*')
      .eq('user_id', userId)
      .eq('synced', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending sync results:', error);
      return [];
    }

    return (data || []).map(r => ({
      id: r.id,
      resultData: r.result_data,
      createdAt: r.created_at,
      synced: r.synced
    }));
  } catch (error) {
    console.error('Error fetching pending sync results:', error);
    return [];
  }
};

export const savePendingSyncResult = async (userId: string, result: PendingSyncResult): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .upsert({
        id: result.id,
        user_id: userId,
        result_data: result.resultData,
        created_at: result.createdAt,
        synced: result.synced
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error saving pending sync result:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving pending sync result:', error);
    return false;
  }
};

export const markPendingSyncResultAsSynced = async (resultId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .update({
        synced: true,
        synced_at: new Date().toISOString()
      })
      .eq('id', resultId);

    if (error) {
      console.error('Error marking pending sync result as synced:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error marking pending sync result as synced:', error);
    return false;
  }
};

export const deletePendingSyncResult = async (resultId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('pending_sync_results')
      .delete()
      .eq('id', resultId);

    if (error) {
      console.error('Error deleting pending sync result:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting pending sync result:', error);
    return false;
  }
};

export const syncPendingResultsToCloud = async (
  userId: string,
  localResults: PendingSyncResult[]
): Promise<PendingSyncResult[]> => {
  try {
    // Fetch server results
    const serverResults = await fetchPendingSyncResults(userId);
    const serverResultMap = new Map(serverResults.map(r => [r.id, r]));
    
    const mergedResults: PendingSyncResult[] = [];
    const processedIds = new Set<string>();
    
    // Process local results
    for (const localResult of localResults) {
      mergedResults.push(localResult);
      processedIds.add(localResult.id);
      
      if (!serverResultMap.has(localResult.id)) {
        // Upload to server
        await savePendingSyncResult(userId, localResult);
      }
    }
    
    // Add server results that aren't local
    for (const serverResult of serverResults) {
      if (!processedIds.has(serverResult.id)) {
        mergedResults.push(serverResult);
        processedIds.add(serverResult.id);
      }
    }
    
    return mergedResults;
  } catch (error) {
    console.error('Error syncing pending results:', error);
    return localResults;
  }
};
