import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = JSON.parse(readFileSync('vercel.json.example', 'utf8'));
const production = JSON.parse(readFileSync('vercel.json', 'utf8'));

describe.each([
  ['template', template, 'replace-with-render-host.invalid'],
  ['production', production, 'eduflow-api-og4r.onrender.com'],
])('Vercel %s deployment configuration', (_name, config, hostname) => {
  it('proxies the unchanged API prefix before the SPA fallback', () => {
    expect(config.rewrites[0]).toEqual({
      source: '/api/v1/:path*',
      destination: `https://${hostname}/api/v1/:path*`,
    });
    const fallback = new RegExp(`^${config.rewrites[1].source}$`);
    for (const path of ['/login', '/learning', '/courses/python']) {
      expect(fallback.test(path)).toBe(true);
    }
    for (const path of ['/api', '/api/v1/health', '/api/unknown']) {
      expect(fallback.test(path)).toBe(false);
    }
    expect(config.rewrites[1].destination).toBe('/index.html');
  });

  it('disables proxy caching, including authenticated responses', () => {
    expect(config.headers).toEqual([
      {
        source: '/api/v1/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
          { key: 'x-vercel-enable-rewrite-caching', value: '0' },
        ],
      },
    ]);
  });
});

it('changes only the upstream hostname from the reviewed template', () => {
  expect(production).toEqual({
    ...template,
    rewrites: [
      {
        ...template.rewrites[0],
        destination: 'https://eduflow-api-og4r.onrender.com/api/v1/:path*',
      },
      ...template.rewrites.slice(1),
    ],
  });
});
