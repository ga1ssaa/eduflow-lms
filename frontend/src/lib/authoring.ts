import type { QueryClient } from '@tanstack/react-query';
import type { CourseRead, LessonRead, ModuleRead } from './types';
import type { AdminCourseParams, InstructorCourseParams } from './api';

type CourseFields = Pick<
  CourseRead,
  'title' | 'slug' | 'description' | 'category' | 'level'
>;
type ModuleFields = Pick<ModuleRead, 'title'>;
type LessonFields = Pick<LessonRead, 'title' | 'content' | 'video_url'>;

// OpenAPI PATCH schemas include null text, but the runtime validators forbid it.
export type CoursePatch = Partial<CourseFields>;
export type ModulePatch = Partial<ModuleFields>;
export type LessonPatch = Partial<LessonFields>;

function changedFields<T extends object>(
  original: Partial<T>,
  values: Partial<T>,
  fields: ReadonlyArray<keyof T>,
  nullableField?: keyof T,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const field of fields) {
    const value = values[field];
    if (
      value === undefined ||
      (value === null && field !== nullableField) ||
      Object.is(value, original[field])
    )
      continue;
    patch[field] = value;
  }
  return patch;
}

export function buildCoursePatch(
  original: Partial<CourseFields>,
  values: CoursePatch,
): CoursePatch {
  return changedFields(original, values, [
    'title',
    'slug',
    'description',
    'category',
    'level',
  ]);
}

export function buildModulePatch(
  original: Partial<ModuleFields>,
  values: ModulePatch,
): ModulePatch {
  return changedFields(original, values, ['title']);
}

export function buildLessonPatch(
  original: Partial<LessonFields>,
  values: LessonPatch,
): LessonPatch {
  return changedFields(
    original,
    values,
    ['title', 'content', 'video_url'],
    'video_url',
  );
}

export const authoringKeys = {
  courses: (
    userId: string,
    params: InstructorCourseParams | AdminCourseParams = {},
    admin = false,
  ) => [admin ? 'admin' : 'author', userId, 'courses', params] as const,
  course: (userId: string, courseId: string, admin = false) =>
    [admin ? 'admin' : 'author', userId, 'course', courseId] as const,
  stats: (userId: string, courseId: string, admin = false) =>
    [admin ? 'admin' : 'author', userId, 'stats', courseId] as const,
  students: (userId: string, courseId: string, page = 1, admin = false) =>
    [admin ? 'admin' : 'author', userId, 'students', courseId, page] as const,
};

export interface AuthoringInvalidationOptions {
  deletedCourseId?: string;
  deletedCourseSlug?: string;
}

export async function invalidateAuthoring(
  queryClient: QueryClient,
  options: AuthoringInvalidationOptions = {},
): Promise<void> {
  if (options.deletedCourseId || options.deletedCourseSlug) {
    queryClient.removeQueries({
      predicate: ({ queryKey }) => {
        const namespace = queryKey[0];
        if (namespace === 'public-course') {
          return (
            options.deletedCourseSlug !== undefined &&
            queryKey[1] === options.deletedCourseSlug
          );
        }
        return (
          ['author', 'admin', 'student'].includes(String(namespace)) &&
          queryKey[2] === 'course' &&
          options.deletedCourseId !== undefined &&
          queryKey[3] === options.deletedCourseId
        );
      },
    });
  }
  // Curriculum and publication changes also affect public outlines and learner progress.
  await Promise.all(
    ['author', 'admin', 'catalog', 'public-course', 'student'].map(
      (namespace) => queryClient.invalidateQueries({ queryKey: [namespace] }),
    ),
  );
}
