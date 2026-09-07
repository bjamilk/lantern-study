/**
 * Lecturer-first classes — web client (docs/phase-teach-portal-contract.md).
 */
import type {
  ClassAnalytics,
  ClassAssignment,
  ClassAssignmentProgress,
  ClassGenerateResult,
  ClassJoinPreview,
  ClassMaterial,
  ClassMember,
  ClassSection,
  Course,
  InstitutionClassAnalytics,
  InstitutionStaff,
  LmsConnectorStatus,
} from '@lantern/shared';
import { academicRequest } from './academic';

export const fetchMyClasses = (role?: 'instructor' | 'student' | 'all') => {
  const params = new URLSearchParams();
  if (role && role !== 'all') params.set('role', role);
  const qs = params.toString();
  return academicRequest<ClassSection[]>(`/classes${qs ? `?${qs}` : ''}`).then((rows) => rows || []);
};

export const createClass = (input: {
  courseId: string;
  title?: string;
  academicYear?: string;
  semester?: 1 | 2 | null;
  topicId?: string | null;
  topicTitle?: string | null;
}) => academicRequest<ClassSection>('/classes', { method: 'POST', body: JSON.stringify(input) });

export const previewClassByCode = (code: string) =>
  academicRequest<ClassJoinPreview>(`/classes/preview?code=${encodeURIComponent(code)}`);

export const joinClassByCode = (code: string) =>
  academicRequest<ClassSection>('/classes/join', { method: 'POST', body: JSON.stringify({ code }) });

export const fetchClass = (classId: string) =>
  academicRequest<ClassSection>(`/classes/${encodeURIComponent(classId)}`);

export const patchClass = (
  classId: string,
  patch: { title?: string; semester?: 1 | 2 | null; archived?: boolean }
) =>
  academicRequest<ClassSection>(`/classes/${encodeURIComponent(classId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const fetchClassRoster = (classId: string) =>
  academicRequest<{ members: ClassMember[] }>(`/classes/${encodeURIComponent(classId)}/roster`).then(
    (data) => data?.members || []
  );

export const addClassMember = (classId: string, input: { username: string; role?: 'ta' | 'student' }) =>
  academicRequest<ClassMember>(`/classes/${encodeURIComponent(classId)}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const patchClassMember = (
  classId: string,
  userId: string,
  patch: { role?: 'instructor' | 'ta' | 'student'; status?: 'active' | 'removed' }
) =>
  academicRequest<ClassMember>(
    `/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );

export const rotateClassJoinCode = (classId: string) =>
  academicRequest<{ joinCode: string }>(`/classes/${encodeURIComponent(classId)}/rotate-code`, {
    method: 'POST',
  });

export const fetchClassMaterials = (classId: string) =>
  academicRequest<ClassMaterial[]>(`/classes/${encodeURIComponent(classId)}/materials`).then(
    (rows) => rows || []
  );

export const addClassMaterial = (
  classId: string,
  input: { noteId?: string; title?: string; body?: string; kind?: ClassMaterial['kind'] }
) =>
  academicRequest<ClassMaterial>(`/classes/${encodeURIComponent(classId)}/materials`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const publishClassMaterial = (classId: string, materialId: string) =>
  academicRequest<ClassMaterial>(
    `/classes/${encodeURIComponent(classId)}/materials/${encodeURIComponent(materialId)}/publish`,
    { method: 'POST' }
  );

export const unpublishClassMaterial = (classId: string, materialId: string) =>
  academicRequest<ClassMaterial>(
    `/classes/${encodeURIComponent(classId)}/materials/${encodeURIComponent(materialId)}/unpublish`,
    { method: 'POST' }
  );

export const deleteClassMaterial = (classId: string, materialId: string) =>
  academicRequest<{ success: boolean }>(
    `/classes/${encodeURIComponent(classId)}/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE' }
  );

export const copyClassMaterialToNotes = (classId: string, materialId: string) =>
  academicRequest<{ noteId: string; title: string }>(
    `/classes/${encodeURIComponent(classId)}/materials/${encodeURIComponent(materialId)}/copy`,
    { method: 'POST' }
  );

export const generateClassContent = (
  classId: string,
  input: { kind: 'quiz' | 'flashcards' | 'outline'; count?: number }
) =>
  academicRequest<ClassGenerateResult>(
    `/classes/${encodeURIComponent(classId)}/generate`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    120000
  );

export const fetchClassAssignments = (classId: string) =>
  academicRequest<ClassAssignment[]>(`/classes/${encodeURIComponent(classId)}/assignments`).then(
    (rows) => rows || []
  );

export const createClassAssignment = (
  classId: string,
  input: {
    title: string;
    kind: ClassAssignment['kind'];
    dueAt?: string | null;
    payload?: ClassAssignment['payload'];
  }
) =>
  academicRequest<ClassAssignment>(`/classes/${encodeURIComponent(classId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const completeClassAssignment = (
  classId: string,
  assignmentId: string,
  input: { score?: number } = {}
) =>
  academicRequest<ClassAssignmentProgress>(
    `/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}/complete`,
    { method: 'POST', body: JSON.stringify(input) }
  );

export const fetchClassAnalytics = (classId: string) =>
  academicRequest<ClassAnalytics>(`/classes/${encodeURIComponent(classId)}/analytics`);

export const fetchMyClassWork = () =>
  academicRequest<(ClassAssignment & { classTitle?: string; course?: Course })[]>('/classes/work').then(
    (rows) => rows || []
  );

export const fetchOfficialClassMaterials = (courseId?: string | null) => {
  const params = new URLSearchParams();
  if (courseId) params.set('courseId', courseId);
  const qs = params.toString();
  return academicRequest<(ClassMaterial & { classTitle?: string; course?: Course })[]>(
    `/classes/official-materials${qs ? `?${qs}` : ''}`
  ).then((rows) => rows || []);
};

export const fetchMyInstitutionStaff = () =>
  academicRequest<InstitutionStaff[]>('/staff/me').then((rows) => rows || []);

export const fetchInstitutionStaff = (institutionId: string) =>
  academicRequest<InstitutionStaff[]>(`/institutions/${encodeURIComponent(institutionId)}/staff`).then(
    (rows) => rows || []
  );

export const addInstitutionStaff = (
  institutionId: string,
  input: { userId: string; role: InstitutionStaff['role'] }
) =>
  academicRequest<InstitutionStaff>(`/institutions/${encodeURIComponent(institutionId)}/staff`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const fetchInstitutionAnalytics = (institutionId: string) =>
  academicRequest<InstitutionClassAnalytics>(
    `/institutions/${encodeURIComponent(institutionId)}/analytics`
  );

export const setCourseCanonical = (courseId: string, isCanonical: boolean) =>
  academicRequest<Course>(`/courses/${encodeURIComponent(courseId)}/canonical`, {
    method: 'PATCH',
    body: JSON.stringify({ isCanonical }),
  });

export const fetchLmsConnectors = () => academicRequest<LmsConnectorStatus>('/lms/connectors');
