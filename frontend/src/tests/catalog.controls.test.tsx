import { createRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectControl } from '../components/SelectControl';

describe('shared catalog select controls', () => {
  it('retains native options, keyboard focus and controlled change events', async () => {
    const changed = vi.fn();
    function Example() {
      const [value, setValue] = useState('beginner');
      return (
        <form aria-label="Catalog filters">
          <label htmlFor="test-level">Level</label>
          <SelectControl
            id="test-level"
            name="level"
            value={value}
            onChange={(event) => {
              changed(event.currentTarget.value);
              setValue(event.currentTarget.value);
            }}
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </SelectControl>
        </form>
      );
    }
    render(<Example />);
    const select = screen.getByRole('combobox', { name: 'Level' });
    expect(select.tagName).toBe('SELECT');
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Beginner', 'Intermediate', 'Advanced']);
    await userEvent.tab();
    expect(select).toHaveFocus();
    // jsdom has no operating-system option popup; real ArrowDown/Enter is audited in Playwright.
    await userEvent.selectOptions(select, 'intermediate');
    expect(select).toHaveValue('intermediate');
    expect(changed).toHaveBeenCalledExactlyOnceWith('intermediate');
    expect(
      new FormData(
        screen.getByRole('form', {
          name: 'Catalog filters',
        }) as HTMLFormElement,
      ).get('level'),
    ).toBe('intermediate');
  });

  it('forwards the native ref, help association, validation and select class', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <>
        <SelectControl
          ref={ref}
          aria-label="Level"
          aria-describedby="level-help"
          aria-invalid="true"
          required
          className="specific-level"
          defaultValue="beginner"
        >
          <option value="beginner">Beginner</option>
          <option value="advanced" disabled>
            Advanced
          </option>
        </SelectControl>
        <p id="level-help">Choose a learning level.</p>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Level' });
    expect(ref.current).toBe(select);
    expect(select).toHaveAccessibleDescription('Choose a learning level.');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toBeRequired();
    expect(select).toHaveClass('select-input', 'specific-level');
    expect(screen.getByRole('option', { name: 'Advanced' })).toBeDisabled();
  });

  it('keeps a disabled loading control inert and outside keyboard navigation', async () => {
    const changed = vi.fn();
    render(
      <>
        <SelectControl
          aria-label="Level"
          aria-busy="true"
          defaultValue="beginner"
          disabled
          onChange={changed}
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
        </SelectControl>
        <button>Next control</button>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Level' });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-busy', 'true');
    await userEvent.selectOptions(select, 'intermediate');
    expect(select).toHaveValue('beginner');
    expect(changed).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
  });

  it('renders one decorative chevron while exposing only the native select to assistive technology', () => {
    const view = render(
      <SelectControl aria-label="Color theme" defaultValue="light">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </SelectControl>,
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(view.container.querySelectorAll('.select-control')).toHaveLength(1);
    const arrows = view.container.querySelectorAll('.select-chevron');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toHaveAttribute('aria-hidden', 'true');
    expect(arrows[0]).toHaveAttribute('focusable', 'false');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
