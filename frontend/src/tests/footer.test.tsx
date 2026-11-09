import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Footer } from '../components/Footer';
import type { User } from '../lib/types';

function show(user: Pick<User, 'role'> | null = null, showNavigation = true) {
  return render(
    <MemoryRouter>
      <Footer user={user} showNavigation={showNavigation} />
    </MemoryRouter>,
  );
}

describe('shared footer', () => {
  it('renders one footer with existing branding and clearly described demo contact links', () => {
    show();
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(screen.getByText('EduFlow')).toBeVisible();
    expect(screen.getByText('A clear path to your next skill.')).toBeVisible();
    const contact = screen.getByRole('region', { name: 'Contact & Support' });
    expect(
      within(contact).getByRole('heading', {
        level: 2,
        name: 'Contact & Support',
      }),
    ).toBeVisible();
    const note = 'Demo address, not a functioning support inbox.';
    expect(within(contact).getByText(note)).toBeVisible();
    for (const name of ['Contact Support', 'support@eduflow.example']) {
      const link = within(contact).getByRole('link', { name });
      expect(link).toHaveAttribute('href', 'mailto:support@eduflow.example');
      expect(link).toHaveAccessibleDescription(note);
    }
  });

  it('keeps public navigation destinations and labels', () => {
    show();
    const navigation = screen.getByRole('navigation', {
      name: 'Footer navigation',
    });
    expect(
      within(navigation).getByRole('link', { name: 'Explore courses' }),
    ).toHaveAttribute('href', '/courses');
    expect(
      within(navigation).getByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/login');
  });

  it.each([
    ['student', '/learning'],
    ['instructor', '/instructor'],
    ['admin', '/admin'],
  ] as const)('keeps the %s workspace destination', (role, destination) => {
    show({ role });
    expect(
      screen.getByRole('link', { name: 'Your workspace' }),
    ).toHaveAttribute('href', destination);
    expect(
      screen.queryByRole('link', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
  });

  it('keeps support visible when catalog navigation is suppressed', () => {
    show(null, false);
    expect(
      screen.queryByRole('navigation', { name: 'Footer navigation' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(
      screen.getByRole('region', { name: 'Contact & Support' }),
    ).toBeVisible();
  });
});
