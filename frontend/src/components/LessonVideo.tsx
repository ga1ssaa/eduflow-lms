import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { safeVideo } from './ui';
import './lesson-video.css';

export function LessonVideo({
  url,
  title,
}: {
  url: string | null;
  title: string;
}) {
  if (!url) return null;
  const source = safeVideo(url);
  if (!source || new URL(source).username || new URL(source).password)
    return <p role="status">This lesson’s video URL is not supported.</p>;
  const direct =
    new URL(source).protocol === 'https:' &&
    /\.(mp4|webm|ogv)$/i.test(new URL(source).pathname);
  return direct ? (
    <VideoMedia key={source} source={source} title={title} />
  ) : (
    <SourceLink source={source} />
  );
}

function SourceLink({ source }: { source: string }) {
  return (
    <a
      className="video-link"
      href={source}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open lesson video <ExternalLink size={18} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function VideoMedia({ source, title }: { source: string; title: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <div className="lesson-video">
      <video
        aria-label={`Lesson video: ${title}`}
        controls
        playsInline
        preload="metadata"
        src={source}
        onLoadedMetadata={() => setState('ready')}
        onError={() => setState('error')}
      >
        Your browser does not support this video format.
      </video>
      {state !== 'ready' && (
        <p className="small muted" role="status">
          {state === 'loading'
            ? 'Loading video… You can keep reading below.'
            : 'The video could not load. You can open the source or continue with the lesson text.'}
        </p>
      )}
      <SourceLink source={source} />
    </div>
  );
}
