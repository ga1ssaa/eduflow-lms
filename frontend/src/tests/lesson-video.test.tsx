import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonVideo } from '../components/LessonVideo';

const source = 'https://upload.wikimedia.org/test-educational-video.webm';

describe('lesson video media', () => {
  it('does not add a video region when a lesson has no video', () => {
    const { container } = render(
      <LessonVideo url={null} title="Text lesson" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('provides native playback controls without autoplay or completion coupling', () => {
    render(<LessonVideo url={source} title="Web foundations" />);
    const video = screen.getByLabelText('Lesson video: Web foundations');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).not.toHaveAttribute('autoplay');
    expect(screen.getByRole('status')).toHaveTextContent('Loading video');
    fireEvent.loadedMetadata(video);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.ended(video);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a safe source link after a load failure and never blocks text learning', () => {
    render(<LessonVideo url={source} title="Lesson" />);
    fireEvent.error(screen.getByLabelText('Lesson video: Lesson'));
    expect(screen.getByRole('status')).toHaveTextContent('could not load');
    expect(screen.getByRole('link')).toHaveAttribute('href', source);
    expect(screen.getByRole('link')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('preserves external provider links instead of attempting unsafe embeds', () => {
    render(
      <LessonVideo url="https://example.test/watch?v=lesson" title="Lesson" />,
    );
    expect(screen.queryByLabelText(/Lesson video:/)).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://example.test/watch?v=lesson',
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:video/mp4;base64,AA',
    'invalid',
    'https://user:secret@example.test/lesson.mp4',
  ])('rejects unsupported or credential-bearing media: %s', (url) => {
    render(<LessonVideo url={url} title="Lesson" />);
    expect(screen.getByRole('status')).toHaveTextContent('not supported');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('resets the loading/error state when navigating to a different video', () => {
    const view = render(<LessonVideo url={source} title="First" />);
    fireEvent.error(screen.getByLabelText('Lesson video: First'));
    view.rerender(
      <LessonVideo url="https://example.test/second.mp4" title="Second" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading video');
  });
});
