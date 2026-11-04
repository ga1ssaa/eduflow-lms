import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { invalidateAuthoring } from '../lib/authoring';
import { isApiError } from '../lib/client';
import type { CourseRead } from '../lib/types';
import { ConfirmDialog } from './authoring';
import { ErrorPanel } from './ui';

export function CourseActions({
  course,
  admin = false,
}: {
  course: CourseRead;
  admin?: boolean;
}) {
  const [action, setAction] = useState<
    'publish' | 'unpublish' | 'delete' | null
  >(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async (selected: 'publish' | 'unpublish' | 'delete') => {
      if (selected === 'delete') await api.deleteCourse(course.id);
      else if (selected === 'publish')
        await api.publishCourse(course.id, admin);
      else await api.unpublishCourse(course.id, admin);
    },
    onSuccess: async (_, selected) => {
      setAction(null);
      await invalidateAuthoring(
        queryClient,
        selected === 'delete'
          ? { deletedCourseId: course.id, deletedCourseSlug: course.slug }
          : undefined,
      );
      if (selected === 'delete')
        navigate(admin ? '/admin/courses' : '/instructor/courses', {
          replace: true,
        });
    },
    onError: async (error) => {
      if (isApiError(error) && error.status === 409)
        await invalidateAuthoring(queryClient);
    },
  });
  const open = (selected: 'publish' | 'unpublish' | 'delete') => {
    mutation.reset();
    setAction(selected);
  };
  const labels = {
    publish: 'Publish course',
    unpublish: 'Unpublish course',
    delete: 'Delete draft',
  };
  return (
    <>
      <div className="actions course-actions" aria-label="Course actions">
        {!admin && (
          <>
            <Link
              className="button secondary"
              to={`/instructor/courses/${course.id}/edit`}
            >
              Edit details
            </Link>
            <Link
              className="button secondary"
              to={`/instructor/courses/${course.id}/curriculum`}
            >
              Edit curriculum
            </Link>
            <Link
              className="button secondary"
              to={`/instructor/courses/${course.id}/students`}
            >
              Student progress
            </Link>
          </>
        )}
        <button
          className="button primary"
          disabled={mutation.isPending}
          onClick={() =>
            open(course.status === 'published' ? 'unpublish' : 'publish')
          }
        >
          {course.status === 'published'
            ? 'Unpublish course'
            : 'Publish course'}
        </button>
        {!admin && (
          <button
            className="button secondary danger-button"
            disabled={course.status !== 'draft' || mutation.isPending}
            onClick={() => open('delete')}
          >
            Delete draft
          </button>
        )}
      </div>
      {!admin && course.status === 'published' && (
        <p className="small muted">
          Unpublish this course before deleting it. Courses with enrollments
          cannot be deleted.
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="success-message">
          Course updated successfully.
        </p>
      )}
      {mutation.isError && !action && <ErrorPanel error={mutation.error} />}
      <ConfirmDialog
        open={action !== null}
        title={action ? labels[action] : ''}
        confirmLabel={action ? labels[action] : ''}
        pending={mutation.isPending}
        danger={action === 'delete'}
        error={mutation.isError ? mutation.error : undefined}
        onCancel={() => setAction(null)}
        onConfirm={() => {
          if (action) mutation.mutate(action);
        }}
      >
        <p>
          {action === 'delete'
            ? `Permanently delete “${course.title}” and its curriculum? This cannot be undone. Enrollments and learning records prevent deletion.`
            : action === 'unpublish'
              ? `Hide “${course.title}” from the catalog and pause student lesson access? Existing enrollments and progress will be preserved.`
              : `Publish “${course.title}” to the public catalog? The server will verify that its curriculum is complete.`}
        </p>
      </ConfirmDialog>
    </>
  );
}
