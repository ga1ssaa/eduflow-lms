import '../pages.css';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import {
  buildLessonPatch,
  buildModulePatch,
  invalidateAuthoring,
} from '../lib/authoring';
import { isApiError } from '../lib/client';
import type { LessonRead, ModuleRead } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Badge, ErrorPanel, Loading, PageHeading } from '../components/ui';
import {
  ConfirmDialog,
  Field,
  fieldDescription,
  MutationError,
  useAuthoringDirty,
} from '../components/authoring';
import '../authoring.css';

type Run = <T>(action: () => Promise<T>) => Promise<T>;
type DeleteTarget = { kind: 'module' | 'lesson'; id: string; title: string };
export function CurriculumPage() {
  const { courseId = '' } = useParams();
  return <CurriculumEditor key={courseId} courseId={courseId} />;
}
function CurriculumEditor({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [deletion, setDeletion] = useState<DeleteTarget | null>(null);
  const course = useQuery({
    queryKey: ['author', user!.id, 'course', courseId],
    queryFn: ({ signal }) => api.managementCourse(courseId, false, signal),
  });
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => invalidateAuthoring(client),
    onError: async (error) => {
      if (isApiError(error) && error.status === 409)
        await invalidateAuthoring(client);
    },
  });
  const run: Run = async (action) =>
    (await mutation.mutateAsync(action)) as Awaited<ReturnType<typeof action>>;
  const move = (ids: string[], index: number, direction: -1 | 1) => {
    const next = [...ids];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    return { ids: next };
  };
  const remove = async () => {
    if (!deletion) return;
    try {
      await run(() =>
        deletion.kind === 'module'
          ? api.deleteModule(deletion.id)
          : api.deleteLesson(deletion.id),
      );
      setDeletion(null);
    } catch {
      /* The dialog retains the actionable mutation error. */
    }
  };
  const askDelete = (target: DeleteTarget) => {
    mutation.reset();
    setDeletion(target);
  };
  if (!course.data && course.isPending)
    return <Loading label="Loading curriculum…" />;
  if (!course.data)
    return (
      <ErrorPanel error={course.error} retry={() => void course.refetch()} />
    );
  const c = course.data;
  const pending = mutation.isPending;
  return (
    <>
      <Link className="back-link" to={`/instructor/courses/${c.id}`}>
        ← Course overview
      </Link>
      <PageHeading eyebrow="COURSE AUTHORING" title="Manage curriculum">
        <p>{c.title}</p>
      </PageHeading>
      <div className="course-metadata curriculum-course-summary surface">
        <Badge success={c.status === 'published'}>{c.status}</Badge>
        <Link className="text-link" to={`/instructor/courses/${c.id}/edit`}>
          Edit course details
        </Link>
        <span>
          {c.modules.length} modules · {c.lesson_count} lessons
        </span>
      </div>
      {c.status === 'published' && (
        <p className="author-notice">
          This course is published. Changes must keep every lesson ready for
          learners. Unpublish from the course overview if you need to make an
          incomplete draft.
        </p>
      )}
      {mutation.isError && !deletion && (
        <MutationError error={mutation.error} />
      )}
      {mutation.isSuccess && (
        <p role="status" className="author-save-status">
          Curriculum updated.
        </p>
      )}
      {course.isError && (
        <ErrorPanel error={course.error} retry={() => void course.refetch()} />
      )}
      <div className="author-curriculum product-curriculum">
        {c.modules.length === 0 && (
          <p className="author-notice">
            Add your first module, then add lessons inside it.
          </p>
        )}
        {c.modules.map((module, moduleIndex) => (
          <section
            key={module.id}
            className="author-module surface"
            aria-label={`Module: ${module.title}`}
          >
            <div className="author-module-heading">
              <div data-reveal>
                <p className="eyebrow">MODULE {module.position}</p>
                <h2>{module.title}</h2>
              </div>
              <div className="author-structural-actions">
                <button
                  className="icon-button"
                  aria-label={`Move module ${module.title} up`}
                  disabled={pending || moduleIndex === 0}
                  onClick={() =>
                    void run(() =>
                      api.reorderModules(
                        c.id,
                        move(
                          c.modules.map((m) => m.id),
                          moduleIndex,
                          -1,
                        ),
                      ),
                    ).catch(() => undefined)
                  }
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Move module ${module.title} down`}
                  disabled={pending || moduleIndex === c.modules.length - 1}
                  onClick={() =>
                    void run(() =>
                      api.reorderModules(
                        c.id,
                        move(
                          c.modules.map((m) => m.id),
                          moduleIndex,
                          1,
                        ),
                      ),
                    ).catch(() => undefined)
                  }
                >
                  <ArrowDown size={18} aria-hidden="true" />
                </button>
                <button
                  className="button secondary"
                  disabled={pending}
                  aria-label={`Delete module: ${module.title}`}
                  onClick={() =>
                    askDelete({
                      kind: 'module',
                      id: module.id,
                      title: module.title,
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete module
                </button>
              </div>
            </div>
            <ModuleTitleForm module={module} pending={pending} run={run} />
            <div className="author-lesson-list">
              {module.lessons.length === 0 && (
                <p className="muted small">No lessons yet.</p>
              )}
              {module.lessons.map((lesson, lessonIndex) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  pending={pending}
                  run={run}
                  onDelete={() =>
                    askDelete({
                      kind: 'lesson',
                      id: lesson.id,
                      title: lesson.title,
                    })
                  }
                  onMove={(direction) =>
                    void run(() =>
                      api.reorderLessons(
                        module.id,
                        move(
                          module.lessons.map((l) => l.id),
                          lessonIndex,
                          direction,
                        ),
                      ),
                    ).catch(() => undefined)
                  }
                  first={lessonIndex === 0}
                  last={lessonIndex === module.lessons.length - 1}
                />
              ))}
            </div>
            <details className="author-add-lesson">
              <summary>
                <Plus size={16} aria-hidden="true" />
                Add a lesson
              </summary>
              <LessonForm
                key={`new-${module.id}`}
                moduleId={module.id}
                pending={pending}
                run={run}
              />
            </details>
          </section>
        ))}
        <NewModuleForm courseId={c.id} pending={pending} run={run} />
      </div>
      <ConfirmDialog
        open={!!deletion}
        title={`Delete ${deletion?.kind ?? 'item'}?`}
        confirmLabel={`Delete ${deletion?.kind ?? 'item'}`}
        danger
        pending={pending}
        error={mutation.error}
        onConfirm={() => void remove()}
        onCancel={() => {
          setDeletion(null);
          mutation.reset();
        }}
      >
        <p>
          Delete “{deletion?.title}”?{' '}
          {deletion?.kind === 'module'
            ? 'Its lessons and unsaved changes in this module will also be removed.'
            : 'Its content and unsaved changes will be removed.'}{' '}
          This cannot be undone.
        </p>
        <p>
          Learning records may prevent deletion. Nothing is removed if the
          server rejects the request.
        </p>
      </ConfirmDialog>
    </>
  );
}
function ModuleTitleForm({
  module,
  pending,
  run,
}: {
  module: ModuleRead;
  pending: boolean;
  run: Run;
}) {
  const [baseline, setBaseline] = useState(module.title);
  const [title, setTitle] = useState(module.title);
  const [error, setError] = useState<unknown>(null);
  const clear = useAuthoringDirty(title !== baseline);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      const result = await run(() =>
        api.updateModule(
          module.id,
          buildModulePatch({ title: baseline }, { title: title.trim() }),
        ),
      );
      setTitle(result.title);
      setBaseline(result.title);
      clear();
    } catch (error) {
      setError(error);
    }
  };
  const fieldError = isApiError(error) ? error.fieldErrors.title : undefined;
  return (
    <form
      className="author-module-title"
      onSubmit={(event) => void submit(event)}
    >
      <Field
        label="Module title"
        name={`module-${module.id}`}
        error={fieldError}
      >
        <input
          aria-label={`Module title: ${module.title}`}
          required
          maxLength={200}
          value={title}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!fieldError}
          aria-describedby={fieldDescription(`module-${module.id}`, fieldError)}
        />
      </Field>
      <button
        className="button secondary"
        disabled={pending || title === baseline || !title.trim()}
      >
        Save module
      </button>
      {error != null && <MutationError error={error} />}
    </form>
  );
}
function NewModuleForm({
  courseId,
  pending,
  run,
}: {
  courseId: string;
  pending: boolean;
  run: Run;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<unknown>(null);
  const clear = useAuthoringDirty(!!title);
  const [added, setAdded] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await run(() => api.createModule(courseId, { title: title.trim() }));
      setTitle('');
      clear();
      setAdded(true);
    } catch (error) {
      setError(error);
    }
  };
  const fieldError = isApiError(error) ? error.fieldErrors.title : undefined;
  return (
    <form
      className="author-form surface"
      onSubmit={(event) => void submit(event)}
    >
      <h2>Add a module</h2>
      <div className="author-module-title">
        <Field label="New module title" name="new-module" error={fieldError}>
          <input
            required
            maxLength={200}
            value={title}
            disabled={pending}
            onChange={(e) => {
              setTitle(e.target.value);
              setAdded(false);
            }}
            aria-invalid={!!fieldError}
            aria-describedby={fieldDescription('new-module', fieldError)}
          />
        </Field>
        <button className="button primary" disabled={pending || !title.trim()}>
          Add module
        </button>
      </div>
      <MutationError error={error} />
      {added && (
        <p role="status" className="author-save-status">
          Module added.
        </p>
      )}
    </form>
  );
}
function LessonRow({
  lesson,
  pending,
  run,
  onDelete,
  onMove,
  first,
  last,
}: {
  lesson: LessonRead;
  pending: boolean;
  run: Run;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="author-lesson" aria-label={`Lesson: ${lesson.title}`}>
      <div className="author-lesson-heading">
        <h3>
          {lesson.position}. {lesson.title}
        </h3>
        <div className="author-structural-actions">
          <button
            className="icon-button"
            disabled={pending || first}
            aria-label={`Move lesson ${lesson.title} up`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            disabled={pending || last}
            aria-label={`Move lesson ${lesson.title} down`}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <button
            className="button secondary"
            disabled={pending}
            aria-label={`Delete lesson: ${lesson.title}`}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
      {!editing ? (
        <button
          className="button secondary"
          disabled={pending}
          aria-label={`Edit lesson: ${lesson.title}`}
          onClick={() => setEditing(true)}
        >
          Edit lesson
        </button>
      ) : (
        <LessonForm
          initial={lesson}
          moduleId={lesson.module_id}
          pending={pending}
          run={run}
        />
      )}
    </article>
  );
}
type LessonValues = { title: string; content: string; video_url: string };
const lessonValues = (lesson?: LessonRead): LessonValues => ({
  title: lesson?.title ?? '',
  content: lesson?.content ?? '',
  video_url: lesson?.video_url ?? '',
});
function LessonForm({
  initial,
  moduleId,
  pending,
  run,
}: {
  initial?: LessonRead;
  moduleId: string;
  pending: boolean;
  run: Run;
}) {
  const [baseline, setBaseline] = useState(() => lessonValues(initial));
  const [values, setValues] = useState(baseline);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const clear = useAuthoringDirty(dirty);
  const prefix = `lesson-${initial?.id ?? moduleId}`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const next = {
      title: values.title.trim(),
      content: values.content.trim(),
      video_url: values.video_url.trim() || null,
    };
    const errors: Record<string, string> = {};
    if (!next.title) errors.title = 'Enter a lesson title.';
    if (next.video_url) {
      try {
        const url = new URL(next.video_url);
        if (!['http:', 'https:'].includes(url.protocol))
          errors.video_url = 'Use an HTTP or HTTPS video URL.';
      } catch {
        errors.video_url = 'Enter a valid HTTP or HTTPS video URL.';
      }
    }
    for (const [key, value] of Object.entries(next))
      if (typeof value === 'string' && value.includes('\0'))
        errors[key] = 'Remove unsupported NUL characters.';
    setValidation(errors);
    if (Object.keys(errors).length) return;
    try {
      const result = await run(() =>
        initial
          ? api.updateLesson(
              initial.id,
              buildLessonPatch(
                { ...baseline, video_url: baseline.video_url || null },
                next,
              ),
            )
          : api.createLesson(moduleId, next),
      );
      const reset = initial ? lessonValues(result) : lessonValues();
      setValues(reset);
      setBaseline(reset);
      clear();
      setSaved(true);
    } catch (error) {
      setError(error);
    }
  };
  const serverErrors = isApiError(error) ? error.fieldErrors : {};
  const errors = { ...serverErrors, ...validation };
  const change = (key: keyof LessonValues, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setValidation((previous) => ({ ...previous, [key]: '' }));
    setError(null);
    setSaved(false);
  };
  return (
    <form
      className="author-lesson-form"
      aria-label={initial ? `Edit lesson: ${initial.title}` : 'Add lesson'}
      onSubmit={(event) => void submit(event)}
    >
      <fieldset disabled={pending}>
        <legend className="sr-only">
          {initial ? 'Lesson details' : 'New lesson'}
        </legend>
        <Field
          label="Lesson title"
          name={`${prefix}-title`}
          error={errors.title}
        >
          <input
            required
            maxLength={200}
            value={values.title}
            onChange={(e) => change('title', e.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby={fieldDescription(`${prefix}-title`, errors.title)}
          />
        </Field>
        <Field
          label="Lesson content"
          name={`${prefix}-content`}
          error={errors.content}
          help="Plain text. Add lesson content, a video URL, or both before publishing."
        >
          <textarea
            rows={8}
            maxLength={100000}
            value={values.content}
            onChange={(e) => change('content', e.target.value)}
            aria-invalid={!!errors.content}
            aria-describedby={fieldDescription(
              `${prefix}-content`,
              errors.content,
              true,
            )}
          />
        </Field>
        <Field
          label="Video URL"
          name={`${prefix}-video`}
          error={errors.video_url}
          help="Optional HTTP or HTTPS URL. Clear this field to remove the current video."
        >
          <input
            type="url"
            maxLength={2048}
            value={values.video_url}
            onChange={(e) => change('video_url', e.target.value)}
            aria-invalid={!!errors.video_url}
            aria-describedby={fieldDescription(
              `${prefix}-video`,
              errors.video_url,
              true,
            )}
          />
        </Field>
        <MutationError error={error} />
        <div className="author-save-row">
          <button
            className="button primary"
            disabled={pending || (!!initial && !dirty) || !values.title.trim()}
          >
            {pending
              ? 'Saving lesson…'
              : initial
                ? 'Save lesson'
                : 'Add lesson'}
          </button>
          <span role="status" className="author-save-status">
            {saved
              ? initial
                ? 'Lesson saved.'
                : 'Lesson added.'
              : dirty
                ? 'Unsaved lesson changes'
                : ''}
          </span>
        </div>
      </fieldset>
    </form>
  );
}
