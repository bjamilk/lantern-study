import React, { useEffect, useState } from 'react';
import type { Course, InstitutionClassAnalytics, InstitutionStaff, LmsConnectorStatus } from '@lantern/shared';
import { Button, Card, Input, ScreenHeader } from '../ui';
import { CoursePicker } from '../academic/CoursePicker';
import {
  addInstitutionStaff,
  fetchInstitutionAnalytics,
  fetchLmsConnectors,
  fetchMyInstitutionStaff,
  setCourseCanonical,
} from '../../services/classes';

export const TeachUniversityAdmin: React.FC = () => {
  const [staff, setStaff] = useState<InstitutionStaff[]>([]);
  const [analytics, setAnalytics] = useState<InstitutionClassAnalytics | null>(null);
  const [lms, setLms] = useState<LmsConnectorStatus | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [staffUserId, setStaffUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMyInstitutionStaff(), fetchLmsConnectors()])
      .then(([rows, connectors]) => {
        if (cancelled) return;
        setStaff(rows);
        setLms(connectors);
        const admin = rows.find((row) => row.role === 'institution_admin' || row.role === 'department_admin');
        if (admin) {
          return fetchInstitutionAnalytics(admin.institutionId).then((stats) => {
            if (!cancelled) setAnalytics(stats);
          });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canCanon = staff.some(
    (row) => row.role === 'institution_admin' || row.role === 'department_admin'
  );
  const adminCampus = staff.find((row) => row.role === 'institution_admin');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-8">
      <ScreenHeader
        title="University"
        subtitle="Campus staff tools. Lecturers do not need this to run a class."
      />
      {error ? <p className="text-body text-lantern-error">{error}</p> : null}
      {staff.length === 0 ? (
        <Card padding="md">
          <p className="text-body text-lantern-text">
            You are not listed as campus staff. You can still create classes from the Classes tab — university admin is optional.
          </p>
        </Card>
      ) : (
        <Card padding="md">
          <p className="text-caption text-lantern-text-secondary">Your campus roles</p>
          <ul className="mt-2 flex flex-col gap-1">
            {staff.map((row) => (
              <li key={`${row.institutionId}-${row.role}`} className="text-body text-lantern-text">
                {row.institutionName || row.institutionId} · {row.role.replace('_', ' ')}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {analytics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card padding="md">
            <p className="text-caption text-lantern-text-secondary">Classes</p>
            <p className="text-title font-semibold">{analytics.classCount}</p>
          </Card>
          <Card padding="md">
            <p className="text-caption text-lantern-text-secondary">Members</p>
            <p className="text-title font-semibold">{analytics.memberCount}</p>
          </Card>
          <Card padding="md">
            <p className="text-caption text-lantern-text-secondary">Materials</p>
            <p className="text-title font-semibold">{analytics.publishedMaterialCount}</p>
          </Card>
          <Card padding="md">
            <p className="text-caption text-lantern-text-secondary">Assignments</p>
            <p className="text-title font-semibold">{analytics.assignmentCount}</p>
          </Card>
        </div>
      ) : null}
      {canCanon ? (
        <Card padding="md" className="flex flex-col gap-3">
          <p className="text-body font-medium text-lantern-text">Official course catalogue</p>
          <CoursePicker value={course} onChange={setCourse} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!course}
              onClick={async () => {
                if (!course) return;
                setError(null);
                try {
                  const updated = await setCourseCanonical(course.id, true);
                  setCourse(updated);
                  setMessage(`${updated.code} is now official for this campus.`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not update the course');
                }
              }}
            >
              Mark official
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!course}
              onClick={async () => {
                if (!course) return;
                try {
                  const updated = await setCourseCanonical(course.id, false);
                  setCourse(updated);
                  setMessage(`${updated.code} is no longer official.`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not update the course');
                }
              }}
            >
              Clear official
            </Button>
          </div>
          {message ? <p className="text-caption text-lantern-text-secondary">{message}</p> : null}
        </Card>
      ) : null}
      {adminCampus ? (
        <Card padding="md" className="flex flex-col gap-3">
          <p className="text-body font-medium text-lantern-text">Add campus staff</p>
          <p className="text-caption text-lantern-text-secondary">
            Paste the person’s Lantern user id. This is not required for a lecturer to create a class.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-lantern-text-secondary">User id</span>
            <Input
              value={staffUserId}
              onChange={(event) => setStaffUserId(event.target.value.trim())}
              placeholder="uuid"
            />
          </label>
          <Button
            type="button"
            disabled={!staffUserId}
            onClick={async () => {
              setError(null);
              try {
                await addInstitutionStaff(adminCampus.institutionId, {
                  userId: staffUserId,
                  role: 'instructor',
                });
                setStaffUserId('');
                setMessage('Staff member added.');
                setStaff(await fetchMyInstitutionStaff());
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not add staff');
              }
            }}
          >
            Add as instructor
          </Button>
        </Card>
      ) : null}
      {lms ? (
        <Card padding="md">
          <p className="text-body font-medium text-lantern-text">LMS connectors</p>
          <p className="text-body text-lantern-text-secondary mt-1">{lms.message}</p>
        </Card>
      ) : null}
    </div>
  );
};
