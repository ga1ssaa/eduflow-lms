import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Footer } from '../components/Footer';

function show(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Footer />
    </MemoryRouter>,
  );
}
function emailLinks() {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('mailto:'));
}
beforeEach(() => vi.stubEnv('VITE_CONTACT_EMAIL', undefined));
afterEach(() => vi.unstubAllEnvs());

describe('shared footer', () => {
  it('renders one footer with branding, platform and support columns, and a copyright-only bottom row', () => {
    show();
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'EduFlow home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      screen.getByText('Learn at your own pace. Grow with every lesson.'),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Platform' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Support' }),
    ).toBeVisible();
    expect(
      screen.getByText('© 2026 EduFlow. All rights reserved.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Your workspace' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the default demo note screen-reader-only and describes every email link', () => {
    show();
    expect(emailLinks()).toHaveLength(3);
    const note = screen.getByText(
      'Demo address, not a functioning support inbox.',
    );
    expect(note).toHaveClass('sr-only');
    for (const link of emailLinks()) {
      expect(link).toHaveAttribute('href', 'mailto:support@eduflow.example');
      expect(link).toHaveAccessibleDescription(note.textContent!);
    }
    const support = screen.getByRole('navigation', { name: 'Support' });
    expect(
      within(support).getByRole('link', { name: 'Contact' }),
    ).toBeVisible();
    expect(within(support).getByRole('link', { name: 'Email' })).toBeVisible();
  });

  it.each([
    ['/', '/'],
    ['/courses?search=design&page=2', '/courses?search=design&page=2'],
    ['/learning', '/'],
    ['/admin/courses?status=draft', '/'],
  ])('keeps platform destinations valid on %s', (route, sectionPath) => {
    show(route);
    const platform = screen.getByRole('navigation', { name: 'Platform' });
    expect(
      within(platform).getByRole('link', { name: 'Explore Courses' }),
    ).toHaveAttribute('href', '/courses');
    expect(within(platform).getAllByRole('link')).toHaveLength(2);
    expect(
      within(platform).getByRole('link', { name: 'How It Works' }),
    ).toHaveAttribute('href', `${sectionPath}#how-it-works`);
    expect(
      within(platform).queryByRole('link', { name: 'For Instructors' }),
    ).not.toBeInTheDocument();
    expect(
      within(platform).queryByRole('link', { name: 'About' }),
    ).not.toBeInTheDocument();
  });

  it('displays a configured email after trimming without adding mailto headers', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', '  help+learning@eduflow.org  ');
    show();
    expect(
      screen.getByRole('link', { name: 'help+learning@eduflow.org' }),
    ).toBeVisible();
    for (const link of emailLinks()) {
      expect(link).toHaveAttribute('href', 'mailto:help+learning@eduflow.org');
      expect(link).not.toHaveAttribute('aria-describedby');
    }
    expect(
      screen.queryByText('Demo address, not a functioning support inbox.'),
    ).not.toBeInTheDocument();
  });

  it('retains the assistive demo note for another reserved .example address', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'help@courses.example');
    show();
    expect(
      screen.getByRole('link', { name: 'help@courses.example' }),
    ).toHaveAccessibleDescription(
      'Demo address, not a functioning support inbox.',
    );
  });

  it.each([
    '',
    'not-an-email',
    'support@@eduflow.org',
    'support@-eduflow.org',
    'support@eduflow.org?subject=Hello',
    'support@eduflow.org#fragment',
    'support@eduflow.org\r\nBcc:other@eduflow.org',
    '\nsupport@eduflow.org',
    'support%0aBcc@eduflow.org',
  ])('falls back safely for invalid contact configuration %j', (configured) => {
    vi.stubEnv('VITE_CONTACT_EMAIL', configured);
    show();
    expect(emailLinks()).toHaveLength(3);
    for (const link of emailLinks()) {
      expect(link).toHaveAttribute('href', 'mailto:support@eduflow.example');
      expect(link).toHaveAccessibleDescription(
        'Demo address, not a functioning support inbox.',
      );
    }
  });
});
