import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { safeReturn } from '../components/ui';

describe('authentication return destinations', () => {
  it.each(['/LOGIN', '/Register?from=catalog', '/%6Cogin', '/%72egister#form'])(
    'rejects %s because the router resolves it to an auth page',
    (destination) => {
      expect(
        matchRoutes([{ path: '/login' }, { path: '/register' }], destination),
      ).not.toBeNull();
      expect(safeReturn(destination)).toBe('/learning');
    },
  );

  it('preserves a legitimate private destination and its lesson selection', () => {
    const destination = '/learn/course-id?lesson=lesson-id#notes';
    expect(safeReturn(destination)).toBe(destination);
  });

  it('keeps query and hash contents intact without decoding them as paths', () => {
    const destination = '/courses?search=100%#course%20outline';
    expect(safeReturn(destination)).toBe(destination);
  });

  it.each(['/learn/%', '/%E0%A4%A'])(
    'rejects malformed path encoding %s',
    (destination) => {
      expect(safeReturn(destination)).toBe('/learning');
    },
  );

  it('rejects an auth destination after URL path normalization', () => {
    expect(safeReturn('/courses/../LOGIN')).toBe('/learning');
  });
});
