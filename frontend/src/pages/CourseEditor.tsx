import '../pages.css';
import { SelectControl } from '../components/SelectControl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { buildCoursePatch, invalidateAuthoring } from '../lib/authoring';
import { isApiError } from '../lib/client';
import type { CourseRead, Level } from '../lib/types';
import { Badge, ErrorPanel, Loading, PageHeading } from '../components/ui';
import {
  Field,
  fieldDescription,
  MutationError,
  useAuthoringDirty,
} from '../components/authoring';
import '../authoring.css';

type Values = Pick<
  CourseRead,
  'title' | 'slug' | 'description' | 'category' | 'level'
>;
const blank: Values = {
  title: '',
  slug: '',
  description: '',
  category: '',
  level: 'beginner',
};
const valuesOf = (course: CourseRead): Values => ({
  title: course.title,
  slug: course.slug,
  description: course.description,
  category: course.category,
  level: course.level,
});
export function CourseEditorPage({ create = false }: { create?: boolean }) {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['author', user!.id, 'course', courseId],
    queryFn: ({ signal }) => api.managementCourse(courseId, false, signal),
    enabled: !create,
  });
  if (create) return <CourseForm key="new" />;
  if (!query.data && query.isPending)
    return <Loading label="Loading course editor…" />;
  if (!query.data)
    return (
      <ErrorPanel error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <>
      {query.isError && (
        <ErrorPanel error={query.error} retry={() => void query.refetch()} />
      )}
      <CourseForm key={query.data.id} initial={query.data} />
    </>
  );
}
function CourseForm({ initial }: { initial?: CourseRead }) {
  const [baseline, setBaseline] = useState<Values>(() =>
    initial ? valuesOf(initial) : blank,
  );
  const [values, setValues] = useState<Values>(baseline);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const clearDirty = useAuthoringDirty(dirty);
  const navigate = useNavigate();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (next: Values) =>
      initial
        ? api.updateCourse(initial.id, buildCoursePatch(baseline, next))
        : api.createCourse(next),
    onSuccess: async (course) => {
      const next = valuesOf(course);
      setBaseline(next);
      setValues(next);
      clearDirty();
      setSaved(true);
      await invalidateAuthoring(client);
      if (!initial)
        navigate(`/instructor/courses/${course.id}/edit`, { replace: true });
    },
    onError: async (error) => {
      if (isApiError(error) && error.status === 409)
        await invalidateAuthoring(client);
    },
  });
  const change = (key: keyof Values, value: string) => {
    setSaved(false);
    mutation.reset();
    setValidation((previous) => ({ ...previous, [key]: '' }));
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      ...values,
      title: values.title.trim(),
      description: values.description.trim(),
      category: values.category.trim(),
    };
    const errors: Record<string, string> = {};
    if (!next.title || next.title.length > 200)
      errors.title = 'Enter a title between 1 and 200 characters.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next.slug) || next.slug.length > 200)
      errors.slug =
        'Use lowercase letters and numbers separated by single hyphens, up to 200 characters.';
    for (const [key, value] of Object.entries(next))
      if (typeof value === 'string' && value.includes('\0'))
        errors[key] = 'Remove unsupported NUL characters.';
    setValidation(errors);
    if (Object.keys(errors).length) return;
    mutation.mutate(next);
  };
  const errors = {
    ...(mutation.isError && isApiError(mutation.error)
      ? mutation.error.fieldErrors
      : {}),
    ...validation,
  };
  if (
    mutation.isError &&
    isApiError(mutation.error) &&
    mutation.error.status === 409 &&
    /slug/i.test(mutation.error.message) &&
    !errors.slug
  )
    errors.slug = 'This slug is already in use. Choose another slug.';
  return (
    <>
      <Link
        className="back-link"
        to={
          initial ? `/instructor/courses/${initial.id}` : '/instructor/courses'
        }
      >
        ← {initial ? 'Course overview' : 'My courses'}
      </Link>
      <PageHeading
        eyebrow="COURSE AUTHORING"
        title={initial ? 'Edit course details' : 'Create a course'}
      >
        <p>
          {initial
            ? 'Update the information learners see in the catalog.'
            : 'Start with a draft. Add your curriculum before publishing.'}
        </p>
      </PageHeading>
      {initial && (
        <div className="course-metadata">
          <Badge success={initial.status === 'published'}>
            {initial.status}
          </Badge>
          <Link
            className="text-link"
            to={`/instructor/courses/${initial.id}/curriculum`}
          >
            Manage curriculum
          </Link>
        </div>
      )}
      <div className="author-form-layout">
        <form className="author-form surface" onSubmit={submit}>
          <div className="author-form-heading">
            <span>01</span>
            <div>
              <h2>Course essentials</h2>
              <p>A clear introduction helps the right learners find you.</p>
            </div>
          </div>
          <fieldset disabled={mutation.isPending}>
            <legend className="sr-only">Course details</legend>
            <Field
              label="Course title"
              name="course-title"
              error={errors.title}
            >
              <input
                name="title"
                value={values.title}
                onChange={(e) => change('title', e.target.value)}
                required
                maxLength={200}
                aria-invalid={!!errors.title}
                aria-describedby={fieldDescription(
                  'course-title',
                  errors.title,
                )}
              />
            </Field>
            <Field
              label="Slug"
              name="course-slug"
              error={errors.slug}
              help="Lowercase letters and numbers, separated by single hyphens. Changing the title does not change the slug."
            >
              <input
                name="slug"
                value={values.slug}
                onChange={(e) => change('slug', e.target.value)}
                required
                maxLength={200}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                aria-invalid={!!errors.slug}
                aria-describedby={fieldDescription(
                  'course-slug',
                  errors.slug,
                  true,
                )}
              />
            </Field>
            <Field
              label="Description"
              name="course-description"
              error={errors.description}
            >
              <textarea
                name="description"
                rows={7}
                maxLength={100000}
                value={values.description}
                onChange={(e) => change('description', e.target.value)}
                aria-invalid={!!errors.description}
                aria-describedby={fieldDescription(
                  'course-description',
                  errors.description,
                )}
              />
            </Field>
            <div className="author-field-pair">
              <Field
                label="Category"
                name="course-category"
                error={errors.category}
                help="Enter a category. A category is required before publication."
              >
                <input
                  name="category"
                  maxLength={100}
                  value={values.category}
                  onChange={(e) => change('category', e.target.value)}
                  aria-invalid={!!errors.category}
                  aria-describedby={fieldDescription(
                    'course-category',
                    errors.category,
                    true,
                  )}
                />
              </Field>
              <Field label="Level" name="course-level" error={errors.level}>
                <SelectControl
                  name="level"
                  value={values.level}
                  onChange={(e) => change('level', e.target.value as Level)}
                  aria-invalid={!!errors.level}
                  aria-describedby={fieldDescription(
                    'course-level',
                    errors.level,
                  )}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </SelectControl>
              </Field>
            </div>
            <MutationError error={mutation.error} />
            <div className="author-save-row">
              <button
                className="button primary"
                disabled={mutation.isPending || (!!initial && !dirty)}
              >
                {mutation.isPending
                  ? 'Saving course…'
                  : initial
                    ? 'Save changes'
                    : 'Create course'}
              </button>
              <span className="author-save-status" role="status">
                {saved
                  ? 'Course saved.'
                  : dirty
                    ? 'Unsaved changes'
                    : initial
                      ? 'All changes saved'
                      : 'Draft not created yet'}
              </span>
            </div>
          </fieldset>
        </form>
        <aside className="authoring-guide surface" data-reveal>
          <p className="eyebrow">FROM IDEA TO COURSE</p>
          <h2>Make the first step clear.</h2>
          <ol>
            <li>
              <strong>Set the direction.</strong>
              <p>
                Give your course a specific title, description, category, and
                level.
              </p>
            </li>
            <li>
              <strong>Build the learning path.</strong>
              <p>
                Add modules and lessons to guide learners through your material.
              </p>
            </li>
            <li>
              <strong>Review, then publish.</strong>
              <p>
                Publication requires a complete description, category, and
                lesson content or video.
              </p>
            </li>
          </ol>
          <p className="authoring-guide-note">
            {initial?.status === 'published'
              ? 'Published course edits must keep the curriculum ready for learners.'
              : 'Your draft stays out of the public catalog until it is published.'}
          </p>
        </aside>
      </div>
    </>
  );
}
