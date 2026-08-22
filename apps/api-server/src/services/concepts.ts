/**
 * Concepts — the knowledge-network vocabulary (Phase 1 · C).
 *
 * `concepts` is one row per (course, normalised slug); `concept_links` joins a
 * concept to a flashcard / question / note / deck. Thin on purpose: the
 * concept-tagging UI is Phase 3 P, this module only backs the three endpoints
 * pinned by docs/phase1-learning-events-contract.md §2 (fetchConcepts,
 * createConcept, linkConcept). Shapes in @lantern/shared types Concept /
 * ConceptLink — keep the wire names stable.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  CONCEPT_LINK_TARGET_TYPES,
  CONCEPT_NAME_MAX_LENGTH,
  isUuidLike,
  normalizeConceptName,
  normalizeConceptSlug,
  type ConceptLinkTargetType,
  type ConceptSource,
} from '@lantern/shared/learning';
import { isMissingRelationError } from './learningEvents';

export const DEFAULT_CONCEPT_SEARCH_LIMIT = 20;
export const MAX_CONCEPT_SEARCH_LIMIT = 50;
export const MAX_CONCEPT_TARGET_ID_LENGTH = 128;

const CONCEPT_COLUMNS = 'id, slug, name, parent_id, course_id, source, created_by, created_at';
const CONCEPT_LINK_COLUMNS =
  'concept_id, target_type, target_id, confidence, source, created_by, created_at';

/** Writers allowed through the API (backfill is migration-only). */
const CLIENT_CONCEPT_SOURCES: ReadonlyArray<ConceptSource> = ['ai', 'user', 'import'];

/** Wire shape of a concept (shared type `Concept`). */
export interface ConceptRecord {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  courseId: string | null;
  source: ConceptSource;
  createdBy: string | null;
  createdAt: string;
}

/** Wire shape of a link (shared type `ConceptLink`). */
export interface ConceptLinkRecord {
  conceptId: string;
  targetType: ConceptLinkTargetType;
  targetId: string;
  confidence: number;
  source: ConceptSource;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateConceptInput {
  name: string;
  courseId?: string | null;
  parentId?: string | null;
  source?: string | null;
}

export interface LinkConceptInput {
  targetType: string;
  targetId: string;
  confidence?: number | null;
  source?: string | null;
}

function mapConcept(row: Record<string, unknown>): ConceptRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    parentId: (row.parent_id as string | null) ?? null,
    courseId: (row.course_id as string | null) ?? null,
    source: (row.source as ConceptSource) || 'user',
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

function mapConceptLink(row: Record<string, unknown>): ConceptLinkRecord {
  return {
    conceptId: String(row.concept_id),
    targetType: row.target_type as ConceptLinkTargetType,
    targetId: String(row.target_id),
    confidence: Number(row.confidence ?? 1),
    source: (row.source as ConceptSource) || 'user',
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

function clientSource(value: unknown, fallback: ConceptSource = 'user'): ConceptSource {
  return typeof value === 'string' && (CLIENT_CONCEPT_SOURCES as readonly string[]).includes(value)
    ? (value as ConceptSource)
    : fallback;
}

export class ConceptsService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Name search (ILIKE over the trigram index), optionally scoped to a course. Empty before the migration. */
  async searchConcepts(params: {
    q?: string;
    courseId?: string | null;
    limit?: number;
  }): Promise<ConceptRecord[]> {
    const limit = Math.min(
      MAX_CONCEPT_SEARCH_LIMIT,
      Math.max(1, Math.floor(Number(params.limit) || DEFAULT_CONCEPT_SEARCH_LIMIT))
    );
    const q = typeof params.q === 'string' ? params.q.trim().slice(0, CONCEPT_NAME_MAX_LENGTH) : '';

    let query = this.db.from('concepts').select(CONCEPT_COLUMNS);
    if (params.courseId && isUuidLike(params.courseId)) {
      query = query.eq('course_id', params.courseId);
    }
    if (q) {
      // Escape LIKE metacharacters so a literal "%" in the query stays literal.
      const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      query = query.ilike('name', `%${escaped}%`);
    }
    const { data, error } = await query.order('name', { ascending: true }).limit(limit);
    if (error) {
      if (isMissingRelationError(error)) {
        logger.warn('concepts table is missing; run migration 20260822150000');
        return [];
      }
      throw error;
    }
    return ((data as Record<string, unknown>[] | null) || []).map(mapConcept);
  }

  /** Find-or-create on (course_id, slug). Returns the row either way. */
  async findOrCreateConcept(
    userId: string,
    input: CreateConceptInput
  ): Promise<{ concept: ConceptRecord; created: boolean }> {
    const name = normalizeConceptName(input?.name);
    const slug = normalizeConceptSlug(name);
    if (!slug) throw new PublicError('Concept name is required');
    const courseId = input.courseId && isUuidLike(input.courseId) ? input.courseId : null;
    const parentId = input.parentId && isUuidLike(input.parentId) ? input.parentId : null;

    const existing = await this.lookupBySlug(slug, courseId);
    if (existing) return { concept: existing, created: false };

    const { data, error } = await this.db
      .from('concepts')
      .insert({
        slug,
        name,
        course_id: courseId,
        parent_id: parentId,
        source: clientSource(input.source),
        created_by: userId,
      })
      .select(CONCEPT_COLUMNS)
      .single();
    if (error) {
      // Concurrent create of the same (course, slug) — the unique index wins; return the row.
      if (error.code === '23505') {
        const raced = await this.lookupBySlug(slug, courseId);
        if (raced) return { concept: raced, created: false };
      }
      if (isMissingRelationError(error)) {
        throw new PublicError('Concepts are not available yet');
      }
      throw error;
    }
    return { concept: mapConcept(data as Record<string, unknown>), created: true };
  }

  private async lookupBySlug(slug: string, courseId: string | null): Promise<ConceptRecord | null> {
    let query = this.db.from('concepts').select(CONCEPT_COLUMNS).eq('slug', slug);
    query = courseId ? query.eq('course_id', courseId) : query.is('course_id', null);
    const { data, error } = await query.maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    return data ? mapConcept(data as Record<string, unknown>) : null;
  }

  /** Idempotent link (upsert on the primary-key triple). */
  /**
   * The caller may link a concept to a target only if they own it or have been
   * granted access: notes/decks by ownership or a collaborator row, flashcards
   * through their deck, and group questions (messages) by group membership.
   * Throws PublicError (mapped to 400) when the target is missing or off-limits.
   */
  private async assertCanAccessTarget(
    userId: string,
    targetType: string,
    targetId: string
  ): Promise<void> {
    const denied = () => new PublicError('You do not have access to that item');

    if (targetType === 'note') {
      const { data: note } = await this.db
        .from('notes')
        .select('id, user_id')
        .eq('id', targetId)
        .maybeSingle();
      if (!note) throw denied();
      if (note.user_id === userId) return;
      const { data: collab } = await this.db
        .from('note_collaborators')
        .select('note_id')
        .eq('note_id', targetId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!collab) throw denied();
      return;
    }

    if (targetType === 'deck' || targetType === 'flashcard') {
      let deckId = targetId;
      if (targetType === 'flashcard') {
        const { data: card } = await this.db
          .from('flashcards')
          .select('deck_id')
          .eq('id', targetId)
          .maybeSingle();
        if (!card?.deck_id) throw denied();
        deckId = card.deck_id as string;
      }
      const { data: deck } = await this.db
        .from('decks')
        .select('id, user_id')
        .eq('id', deckId)
        .maybeSingle();
      if (!deck) throw denied();
      if (deck.user_id === userId) return;
      const { data: collab } = await this.db
        .from('deck_collaborators')
        .select('deck_id')
        .eq('deck_id', deckId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!collab) throw denied();
      return;
    }

    if (targetType === 'question') {
      const { data: message } = await this.db
        .from('messages')
        .select('id, group_id, sender_id')
        .eq('id', targetId)
        .maybeSingle();
      if (!message) throw denied();
      if (message.sender_id === userId) return;
      if (message.group_id && (await this.supabaseService.isGroupMember(message.group_id, userId))) {
        return;
      }
      throw denied();
    }

    throw denied();
  }

  async linkConcept(
    userId: string,
    conceptId: string,
    input: LinkConceptInput
  ): Promise<ConceptLinkRecord> {
    if (!isUuidLike(conceptId)) throw new PublicError('Invalid concept id');
    const targetType = input?.targetType;
    if (
      typeof targetType !== 'string' ||
      !(CONCEPT_LINK_TARGET_TYPES as readonly string[]).includes(targetType)
    ) {
      throw new PublicError('targetType must be flashcard, question, note or deck');
    }
    const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    if (!targetId || targetId.length > MAX_CONCEPT_TARGET_ID_LENGTH) {
      throw new PublicError('targetId is required');
    }
    // note/deck/flashcard/question ids are all uuids; reject junk before the
    // access check (a bad id would otherwise 22P02 at the DB).
    if (!isUuidLike(targetId)) throw new PublicError('targetId must be a valid id');
    // A concept link labels someone's artefact and is globally readable, so the
    // caller must own or have access to the target — otherwise a user could tag
    // another student's private notes/decks/questions.
    await this.assertCanAccessTarget(userId, targetType, targetId);
    const confidenceRaw = input.confidence;
    const confidence =
      confidenceRaw == null
        ? 1
        : typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
          ? Math.min(1, Math.max(0, confidenceRaw))
          : null;
    if (confidence === null) throw new PublicError('confidence must be a number between 0 and 1');

    const { data, error } = await this.db
      .from('concept_links')
      .upsert(
        {
          concept_id: conceptId,
          target_type: targetType,
          target_id: targetId,
          confidence,
          source: clientSource(input.source),
          created_by: userId,
        },
        { onConflict: 'concept_id,target_type,target_id' }
      )
      .select(CONCEPT_LINK_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23503') throw new PublicError('Concept not found');
      if (isMissingRelationError(error)) throw new PublicError('Concepts are not available yet');
      throw error;
    }
    return mapConceptLink(data as Record<string, unknown>);
  }
}

let service: ConceptsService | null = null;

export function getConceptsService(supabaseService: SupabaseService): ConceptsService {
  if (!service) service = new ConceptsService(supabaseService);
  return service;
}
