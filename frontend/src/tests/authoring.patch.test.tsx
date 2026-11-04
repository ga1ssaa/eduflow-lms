import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { makeAuthoringCourse } from './authoring.fixtures';

describe('authoring PATCH contracts', () => {
  it('sends only changed course fields without copying response or identity fields', async () => {
    const { buildCoursePatch } = await import('../lib/authoring');
    const original = makeAuthoringCourse();
    expect(
      buildCoursePatch(original, { ...original, title: 'Updated title' }),
    ).toEqual({ title: 'Updated title' });
    expect(buildCoursePatch(original, { ...original })).toEqual({});
  });

  it('preserves intentional empty text but omits null text in course updates', async () => {
    const { buildCoursePatch } = await import('../lib/authoring');
    const original = makeAuthoringCourse();
    expect(
      buildCoursePatch(original, {
        description: '',
        category: '',
        title: undefined,
      }),
    ).toEqual({ description: '', category: '' });
    const invalid = { title: null, description: null } as unknown as Parameters<
      typeof buildCoursePatch
    >[1];
    expect(buildCoursePatch(original, invalid)).toEqual({});
  });

  it('limits module edits to changed titles', async () => {
    const { buildModulePatch } = await import('../lib/authoring');
    const original = makeAuthoringCourse().modules[0];
    expect(buildModulePatch(original, { title: original.title })).toEqual({});
    expect(buildModulePatch(original, { title: 'Renamed module' })).toEqual({
      title: 'Renamed module',
    });
    const invalid = { title: null } as unknown as Parameters<
      typeof buildModulePatch
    >[1];
    expect(buildModulePatch(original, invalid)).toEqual({});
  });

  it('clears video URLs with explicit null and never clears lesson text with null', async () => {
    const { buildLessonPatch } = await import('../lib/authoring');
    const original = makeAuthoringCourse().modules[0].lessons[0];
    expect(
      buildLessonPatch(original, { ...original, video_url: null }),
    ).toEqual({ video_url: null });
    const invalid = {
      title: null,
      content: null,
      video_url: undefined,
    } as unknown as Parameters<typeof buildLessonPatch>[1];
    expect(buildLessonPatch(original, invalid)).toEqual({});
    expect(buildLessonPatch(original, { content: '' })).toEqual({
      content: '',
    });
  });

  it('removes deleted course content and invalidates dependent views without clearing unrelated cache', async () => {
    const { invalidateAuthoring } = await import('../lib/authoring');
    const course = makeAuthoringCourse();
    const client = new QueryClient();
    const deleted = [
      ['author', 'owner', 'course', course.id],
      ['admin', 'moderator', 'course', course.id],
      ['student', 'learner', 'course', course.id],
      ['public-course', course.slug],
    ];
    const dependent = [
      ['author', 'owner', 'courses'],
      ['admin', 'moderator', 'courses'],
      ['catalog', 'all'],
      ['public-course', 'another-course'],
      ['student', 'learner', 'dashboard'],
    ];
    for (const key of [...deleted, ...dependent])
      client.setQueryData(key, course);
    client.setQueryData(['unrelated-preference'], 'keep');
    await invalidateAuthoring(client, {
      deletedCourseId: course.id,
      deletedCourseSlug: course.slug,
    });
    for (const key of deleted) expect(client.getQueryData(key)).toBeUndefined();
    for (const key of dependent)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryData(['unrelated-preference'])).toBe('keep');
    expect(client.getQueryState(['unrelated-preference'])?.isInvalidated).toBe(
      false,
    );
    client.clear();
  });
});
