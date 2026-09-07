# Lecturer-first teach portal — implementation contract

Status: **implemented** (2026-09-07). Parent plan: lecturer-first academic portal (StudyFetch model, Nigeria-fit). This file is the single source of truth for names/shapes so the DB/API builder and the web/mobile builders cannot disagree.

Students stay free. Lecturers start a class without university IT and without Canvas / Google Classroom / Moodle. LMS connectors are **not v1**.

Decisions:

- **D1** Capability is class-scoped (`instructor` | `ta` | `student` on `class_members`). There is no global `is_teacher` flag and nothing is stored in `profiles.settings`.
- **D2** `courses` stays the shared catalogue (BIO 201 at UNILAG, or a letter-only subject such as MATH). `class_sections` is one lecturer’s instance of that course for a session. `class_sections.topic_id` is **optional**: when set, the class covers one `course_topics` row (Fractions) rather than the whole course. A primary or secondary teacher who only teaches a topic still names the parent subject.
- **D3** Join is a short code / `/join/:code` / QR. No LMS, no bulk CSV in v1.
- **D4** Lecturers do **not** read private student notes. They see roster identity, published official materials, assignment progress, and aggregated study telemetry for **that class only**.
- **D5** Official materials prefer a snapshot of an existing note (`body_snapshot`) so the student corpus is grounded in what the lecturer published, not the live private note.
- **D6** Platform admin (`app_metadata.is_platform_admin`) can still act; university staff live in `institution_staff`, not JWT metadata.
- **D7** Instructor affiliation is a school on `profiles.institution_id`, not a teacher flag. Primary and secondary schools are allowed (`marketplace_campuses.kind`). The student `institutions` view stays tertiary-only. Guest `/teach` is an instructor landing; `/signup/teach` is instructor signup.

---

## 1. Database — migration `supabase/migrations/20260907120000_class_sections.sql`

Hand-apply after the latest existing migration. Idempotent (`IF NOT EXISTS`).

### 1a. `class_sections`

One lecturer-owned class instance.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `course_id` | uuid NOT NULL → `courses` ON DELETE RESTRICT | Catalogue row |
| `institution_id` | uuid NULL → `marketplace_campuses` ON DELETE SET NULL | Copied from the course at create (or the lecturer’s profile) |
| `title` | text NOT NULL | 2–120 chars |
| `academic_year` | text NOT NULL | `YYYY/YYYY+1` |
| `semester` | smallint NULL | 1 or 2 |
| `join_code` | text NOT NULL UNIQUE | 6 chars, alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` |
| `created_by` | uuid NOT NULL → `profiles` ON DELETE RESTRICT | Original instructor |
| `archived_at` | timestamptz NULL | Soft-close; join disabled |
| `topic_id` | uuid NULL → `course_topics` ON DELETE SET NULL | When set, this class is one topic, not the whole course. Added in `20260907170000_class_section_topic.sql`. |
| `created_at` / `updated_at` | timestamptz | `update_updated_at_column()` |

Indexes: `course_id`, `institution_id`, `created_by`, unique `join_code`, partial `topic_id`.

### 1b. `class_members`

| Column | Type | Notes |
|---|---|---|
| `class_id` | uuid → `class_sections` ON DELETE CASCADE | |
| `user_id` | uuid → `profiles` ON DELETE CASCADE | |
| `role` | text NOT NULL | `instructor` \| `ta` \| `student` |
| `status` | text NOT NULL DEFAULT `active` | `active` \| `removed` |
| `joined_at` | timestamptz NOT NULL DEFAULT now() | |

PK `(class_id, user_id)`. Partial unique: at most one `active` instructor per class is **not** required (co-teaching is allowed). Index `(user_id, status)`.

On create class: insert the creator as `instructor` / `active`.

### 1c. `class_invites`

Join codes live on `class_sections.join_code` (the hall QR). Optional extra invites (TA links, rotating codes) use this table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `class_id` | uuid → `class_sections` ON DELETE CASCADE | |
| `code` | text NOT NULL UNIQUE | Same alphabet, 6–8 chars |
| `role` | text NOT NULL DEFAULT `student` | `student` \| `ta` |
| `expires_at` | timestamptz NULL | |
| `max_uses` | int NULL | |
| `use_count` | int NOT NULL DEFAULT 0 | |
| `created_by` | uuid → `profiles` | |
| `created_at` | timestamptz | |

The section’s `join_code` is the always-on student invite. Extra rows are optional.

### 1d. `class_materials`

Official corpus. Students read **published snapshots only**.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `class_id` | uuid → `class_sections` ON DELETE CASCADE | |
| `note_id` | uuid NULL → `notes` ON DELETE SET NULL | Source note (instructor-owned) |
| `kind` | text NOT NULL DEFAULT `lecture` | `syllabus` \| `lecture` \| `reading` \| `slide` |
| `title` | text NOT NULL | |
| `body_snapshot` | text NOT NULL DEFAULT `''` | Published grounding text |
| `published_at` | timestamptz NULL | NULL = draft / unpublished |
| `created_by` | uuid → `profiles` | |
| `created_at` / `updated_at` | timestamptz | |

Students: `published_at IS NOT NULL` only. Lecturers never receive another student’s `notes` rows through this table.

### 1e. `class_assignments` + `class_assignment_progress`

Lightweight assigned practice. **Not a gradebook.** No SIS passback.

| `class_assignments` | |
|---|---|
| `id` | uuid PK |
| `class_id` | uuid → `class_sections` ON DELETE CASCADE |
| `created_by` | uuid → `profiles` |
| `title` | text NOT NULL |
| `kind` | `test` \| `deck` \| `notes` \| `open` |
| `due_at` | timestamptz NULL |
| `note_id` | uuid NULL |
| `deck_id` | uuid NULL |
| `payload` | jsonb NOT NULL DEFAULT `{}` | `{ questions?: [], cards?: [], outline?: [] }` |
| `created_at` | timestamptz |

| `class_assignment_progress` | |
|---|---|
| `assignment_id` | uuid → assignments ON DELETE CASCADE |
| `user_id` | uuid → profiles ON DELETE CASCADE |
| `status` | `assigned` \| `completed` |
| `score` | numeric NULL | 0–100 |
| `completed_at` | timestamptz NULL |

PK `(assignment_id, user_id)`.

### 1f. `institution_staff` (Phase 5 foundation; LMS not included)

Verified staff at a campus. **Not** required to create a class (lecturer-first).

| Column | Type | Notes |
|---|---|---|
| `institution_id` | uuid → `marketplace_campuses` ON DELETE CASCADE | |
| `user_id` | uuid → `profiles` ON DELETE CASCADE | |
| `role` | text NOT NULL | `instructor` \| `department_admin` \| `institution_admin` |
| `status` | text NOT NULL DEFAULT `active` | `active` \| `revoked` |
| `created_by` | uuid NULL | |
| `created_at` | timestamptz | |

PK `(institution_id, user_id)`.

`department_admin` / `institution_admin` may set `courses.is_canonical` for courses at that institution. Platform admins always may.

### 1g. RLS

All new tables: ENABLE RLS. Policies:

- `authenticated` SELECT own memberships / published materials of classes they belong to / own progress.
- Writes: **service_role only**. The Express API uses the service role and enforces class-scoped authz in code (same pattern as courses).

---

## 2. Shared (`packages/shared`)

- `src/academic/classes.ts`: join-code alphabet, `normalizeJoinCode`, `isValidJoinCode`, `generateJoinCode`, `CLASS_ROLES`, `STAFF_ROLES`, `materialKind`, assignment kinds, `classJoinPath(code)`, `teachPath(...)`.
- `src/types/index.ts`: `ClassSection`, `ClassMember`, `ClassMaterial`, `ClassAssignment`, `ClassAssignmentProgress`, `ClassAnalytics`, `InstitutionStaff`, `LmsConnectorStatus`.
- `src/api/endpoints.ts`: class + staff client methods listed in §3.
- Export from `src/academic/index.ts`.

Join code: uppercase, strip spaces, 6 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. Generate with crypto random; retry on unique violation.

---

## 3. API — `/api/v1`, `authMiddleware` unless noted

Envelope `{ success, data }` / `{ success:false, error }`. `PublicError` (+ optional `statusCode` 403/404).

Roster privacy: **never return email**. Students and instructors see `id, name, username, avatarUrl, role, joinedAt`.

### Classes

| Method & path | Body / query | Returns | Authz |
|---|---|---|---|
| `GET /classes` | `?role=instructor\|student\|all` | `{ classes: ClassSectionSummary[] }` | Membership |
| `POST /classes` | `{ courseId, title?, academicYear?, semester?, topicId?, topicTitle? }` | `ClassSection` 201 | Any authenticated user. Creator → instructor. Also `ensureEnrolment` for the creator. Caps: 40 classes created / user. `topicId` must belong to `courseId`. `topicTitle` find-or-creates a `course_topics` row when `topicId` is omitted. Default title is the topic title when scoped, otherwise `CODE — course title`. |
| `GET /classes/preview?code=` | | `{ title, course, topic, instructorName, memberCount, academicYear }` | Auth required; does not join |
| `POST /classes/join` | `{ code }` | `ClassSection` | Inserts `student` (or invite `role`). Idempotent if already active. `ensureEnrolment` on the course. 404 invalid/expired; 409 archived. |
| `GET /classes/:classId` | | `ClassSection` + `membership` + `joinCode` (staff only) | Member |
| `PATCH /classes/:classId` | `{ title?, semester?, archived? }` | `ClassSection` | Instructor / TA |
| `GET /classes/:classId/roster` | | `{ members: ClassMember[] }` | Member. No emails. |
| `POST /classes/:classId/members` | `{ username, role?: 'ta'\|'student' }` | `ClassMember` | Instructor |
| `PATCH /classes/:classId/members/:userId` | `{ role?, status? }` | `ClassMember` | Instructor. Cannot remove last instructor. |
| `POST /classes/:classId/rotate-code` | | `{ joinCode }` | Instructor |
| `GET /classes/:classId/materials` | | `ClassMaterial[]` | Students: published only. Staff: all. |
| `POST /classes/:classId/materials` | `{ noteId?, title, body?, kind? }` | `ClassMaterial` | Instructor / TA. If `noteId`, copy title/body from a note **owned by the caller**. |
| `POST /classes/:classId/materials/:id/publish` | | `ClassMaterial` | Instructor / TA |
| `POST /classes/:classId/materials/:id/unpublish` | | `ClassMaterial` | Instructor / TA |
| `DELETE /classes/:classId/materials/:id` | | `{ success }` | Instructor |
| `POST /classes/:classId/generate` | `{ kind: 'quiz'\|'flashcards'\|'outline', count? }` | `{ kind, questions? , cards?, outline? }` | Instructor / TA. Grounds in **published** `body_snapshot` only (≥50 chars for quiz/flashcards). |
| `GET /classes/:classId/assignments` | | `ClassAssignment[]` (+ own progress for students; counts for staff) | Member |
| `POST /classes/:classId/assignments` | `{ title, kind, dueAt?, noteId?, deckId?, payload? }` | `ClassAssignment` 201 | Instructor / TA. Notifies active students (`type: class_assignment`, `link: class:<id>`). |
| `POST /classes/:classId/assignments/:id/complete` | `{ score? }` | `ClassAssignmentProgress` | Student member of the class. Records a learning event. |
| `GET /classes/:classId/analytics` | | `ClassAnalytics` | Instructor / TA |
| `GET /lms/connectors` | | `{ available: false, connectors: [] }` | Auth. Documents that Moodle / Classroom / Canvas are not v1. |
| `GET /schools` | `?q=&kind=` | School summaries | Auth. Search campuses of kind primary/secondary/college/polytechnic/university. |
| `POST /schools` | `{ name, kind, city?, state? }` | School summary 200/201 | Auth. Find-or-create. City/state default `—`. Client then PUTs `institutionId` on the profile. |

`joinCode` is omitted from payloads sent to students.

On join / create: `AcademicCoursesService.ensureEnrolment(userId, courseId, academicYear, semester)` — upsert **one** `user_courses` row as `active` without deleting the rest of the year.

### Institution staff (Phase 5)

| Method & path | Notes |
|---|---|
| `GET /staff/me` | Caller’s `institution_staff` rows (`active`) |
| `GET /institutions/:institutionId/staff` | `institution_admin` or platform admin |
| `POST /institutions/:institutionId/staff` | `{ userId, role }` — platform admin or `institution_admin` of that campus |
| `PATCH /institutions/:institutionId/staff/:userId` | `{ role?, status? }` |
| `GET /institutions/:institutionId/analytics` | Classes / members / published materials counts for that campus — `institution_admin` or platform admin |
| `PATCH /courses/:courseId/canonical` | `{ isCanonical: boolean }` — `department_admin` / `institution_admin` of the course’s institution, or platform admin |

---

## 4. Wire shapes

```
ClassSection {
  id; course: Course; topic: CourseTopic | null; institutionId; title; academicYear; semester; archivedAt;
  createdAt; memberCount; role: ClassRole; joinCode?: string; // staff only
}

ClassJoinPreview { title; course; topic: CourseTopic | null; instructorName; memberCount; academicYear; semester }

ClassMember { userId; name; username; avatarUrl; role; status; joinedAt }

ClassMaterial { id; classId; noteId; kind; title; body?; publishedAt; createdAt }
  // `body` is included for staff always; for students only when published

ClassAssignment {
  id; classId; title; kind; dueAt; noteId; deckId; payload;
  createdAt; progress?: ClassAssignmentProgress; completionCount?: number
}

ClassAnalytics {
  memberCount; publishedMaterialCount; assignmentCount;
  students: [{ userId; name; username; completedAssignments; lastActivityAt; atRisk }];
  atRiskDays: 7
}

InstitutionStaff { institutionId; userId; role; status; createdAt }
```

`atRisk`: no `learning_events` in 7 days **or** an assignment with `due_at` in the past and progress not `completed`. Last activity is `max(learning_events.created_at)` for that user scoped to the class `course_id` when present, else any event.

---

## 5. Web

- Isolated tree: `components/teach/TeachApp.tsx`, lazy-loaded when the path is `/teach` or `/teach/*`. **No** student AppShell, marketplace, jobs, campus social, or gamification chrome.
- Guest `/teach` — instructor landing (primary/secondary/tertiary). CTAs: `/signup/teach`, `/login?next=/teach`. Student home `/` has a **For instructors** link.
- `/signup/teach` — same auth screen, instructor copy. After success, skip student onboarding and open `/teach`. No `is_teacher` flag.
- Affiliation form on Teach home / New class when `institutionId` is missing: search or create a school of any allowed kind, then `PUT` profile `institutionId`.
- `/teach/new` — create a class. Instructors choose **whole course** or **one topic**, type a subject title + short code (created if not listed), and a topic name when scoped. Catalogue pick is secondary.
- `/join/:code` — standalone join page (post-login redirect if signed out). Preview shows the topic when the class is topic-scoped.
- Me → “Teach” opens `/teach`.
- Dashboard: join-class card + assigned work (`ClassWorkCard`).
- Library: “From your lecturer” list of published materials for the selected course (`ClassOfficialMaterials`).
- Companion: optional `classId`; server may also attach published snapshots for classes the user belongs to.

## 6. Mobile

- `JoinClass` modal (Settings → Academic, Dashboard).
- Assigned work on Dashboard; official materials on Library.
- Teach portal is **mobile web** at `/teach` in v1 (no native instructor app). Settings may deep-link the site.

## 7. Out of scope (do not build)

Community, marketplace, jobs inside `/teach`. Gradebook, attendance, SSO, LTI, SCIM, Canvas/Classroom/Moodle sync, native teacher app, charging students for seats.

## 8. Gates

`apps/api-server`: class authz tests (student cannot see `joinCode` or another student’s private notes; join upserts enrolment; last instructor cannot be removed; topic-scoped create stores `topic_id` and rejects a topic from another course). Root typecheck for new files. No commit.
