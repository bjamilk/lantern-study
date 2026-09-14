/**
 * Which materials a study-plan unit's topics were actually generated from.
 *
 * WHY THIS FILE. `study_set_topics.source_note_ids` has carried real provenance
 * since the plan table was created — `topicsFromReadingNotes` stamps the exact
 * note each topic was built from, and `replacePlan` echoes it back. What was
 * missing was the rule for turning those ids into something a student can see
 * without ever making a claim the data does not support.
 *
 * TWO RULES, BOTH ABOUT HONESTY.
 *
 *   1. RESOLVE OR DROP. An id is rendered only when it resolves, against the
 *      materials THE CALLER HOLDS, to a non-blank title. `source_note_ids` is a
 *      `uuid[]`, so Postgres cannot FK its elements: a deleted note leaves a
 *      dangling id behind, and that is expected rather than exceptional. A chip
 *      naming a note that no longer exists — or one that belongs to someone
 *      else — is a lie about where a topic came from, so an id that does not
 *      resolve produces nothing at all. Silence over a wrong claim.
 *
 *   2. NO COMPLETENESS CLAIM. Because callers pass filtered material lists (the
 *      set room drops calendar/lesson/recap/essay notes before generating), a
 *      legitimate source can fail to resolve and its chip will simply not
 *      appear. That is the correct failure direction, but it means the row is
 *      not an inventory. Label it `Sources:` — never "Built from" and never
 *      "all of".
 *
 * And one rule about noise: SUPPRESSION. `unitsFromSourceMaterials` derives
 * units by naming each one after the note its topics came from, so on those
 * units a chip would repeat the heading verbatim. A unit with exactly one
 * source whose title equals the unit's own title therefore returns nothing —
 * the chips then appear exactly where they carry information the heading does
 * not already give: a saved server plan whose units are not 1:1 with materials,
 * or a unit fed by several materials.
 *
 * Pure. No I/O, no inference, no title matching — ids in, resolved ids out.
 */
import { isLectureNote, isWalkableAttachment } from '../learning/courseWorkspace';
import { topicsInUnit, type StudySetTopic } from '../learning/studySetPlan';

/**
 * What the chip's glyph says the material IS.
 *
 * Derived from the RESOLVED material only, never from the topic: the chip and
 * the materials list must agree about what a thing is, and only the material
 * knows.
 */
export type UnitSourceKind = 'note' | 'lecture' | 'pdf';

export interface UnitSource {
  /** The material id — what a tap opens. */
  id: string;
  /** Resolved and trimmed; never blank, never guessed. */
  title: string;
  kind: UnitSourceKind;
}

/**
 * A material as the chips need it. `attachments` and `sourceType` are optional
 * because mobile's plan model carries only `{ id, title }`: a caller that
 * cannot say what a material is gets `note`, which is the shape every material
 * has, rather than a guess.
 */
export interface UnitSourceMaterial {
  id: string;
  title?: string | null;
  sourceType?: string | null;
  attachments?: readonly { id?: string | null; type?: string | null }[] | null;
}

/** The unit, reduced to what the rule reads. */
export interface UnitSourceUnit {
  id: string;
  title?: string | null;
}

function materialKind(material: UnitSourceMaterial): UnitSourceKind {
  // A walkable attachment wins: it is the thing the walkthrough pages through,
  // and it is what the student will recognise on the chip.
  if ((material.attachments ?? []).some((attachment) => isWalkableAttachment(attachment ?? {}))) {
    return 'pdf';
  }
  if (isLectureNote({ title: material.title ?? null, sourceType: material.sourceType ?? null })) {
    return 'lecture';
  }
  return 'note';
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function unitSources(
  unit: UnitSourceUnit,
  topics: readonly StudySetTopic[],
  materials: readonly UnitSourceMaterial[]
): UnitSource[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const seen = new Set<string>();
  const sources: UnitSource[] = [];

  // EVERY source id, not just the first: `source_note_ids` is plural, and a
  // generator that ever derives one topic from two materials already has the
  // shape to say so.
  for (const topic of topicsInUnit(topics, unit.id)) {
    for (const id of topic.sourceNoteIds ?? []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const material = byId.get(id);
      if (!material) continue;
      const title = (material.title || '').trim();
      if (!title) continue;
      sources.push({ id, title, kind: materialKind(material) });
    }
  }

  const unitTitle = (unit.title || '').trim();
  const only = sources.length === 1 ? sources[0] : undefined;
  if (only && unitTitle && sameTitle(only.title, unitTitle)) return [];
  return sources;
}

/** `Open source material: Lecture 3` — the same sentence on both platforms. */
export function unitSourceLabel(source: UnitSource): string {
  return `Open source material: ${source.title}`;
}
