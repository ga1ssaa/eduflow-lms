import { GraduationCap, Mail } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './footer.css';

const fallbackEmail = 'support@eduflow.example';
function contactEmail() {
  const raw: string = import.meta.env.VITE_CONTACT_EMAIL ?? '';
  const configured = raw.trim();
  const [local, domain, extra] = configured.split('@');
  if (
    Array.from(raw).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    configured.length > 254 ||
    !local ||
    local.length > 64 ||
    !domain ||
    extra !== undefined ||
    !/^[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*$/i.test(local) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      domain,
    )
  )
    return fallbackEmail;
  return configured;
}

export function Footer() {
  const location = useLocation();
  const email = contactEmail();
  const isDemoEmail = email.split('@')[1].toLowerCase().endsWith('.example');
  const description = isDemoEmail ? 'footer-contact-note' : undefined;
  const sectionPath =
    location.pathname === '/' || location.pathname === '/courses'
      ? `${location.pathname}${location.search}`
      : '/';
  return (
    <footer className="site-footer">
      <div className="footer-columns">
        <div className="footer-branding">
          <Link to="/" className="footer-brand" aria-label="EduFlow home">
            <GraduationCap size={24} aria-hidden="true" />
            EduFlow
          </Link>
          <p className="footer-description">
            Learn at your own pace. Grow with every lesson.
          </p>
          <a
            className="footer-email"
            href={`mailto:${email}`}
            aria-describedby={description}
          >
            <Mail size={16} aria-hidden="true" />
            {email}
          </a>
        </div>
        <nav className="footer-links" aria-labelledby="footer-platform-title">
          <h2 id="footer-platform-title">Platform</h2>
          <Link to="/courses">Explore Courses</Link>
          <Link to={`${sectionPath}#how-it-works`}>How It Works</Link>
        </nav>
        <nav className="footer-links" aria-labelledby="footer-support-title">
          <h2 id="footer-support-title">Support</h2>
          <a href={`mailto:${email}`} aria-describedby={description}>
            Contact
          </a>
          <a href={`mailto:${email}`} aria-describedby={description}>
            Email
          </a>
        </nav>
      </div>
      {isDemoEmail && (
        <p id="footer-contact-note" className="sr-only">
          Demo address, not a functioning support inbox.
        </p>
      )}
      <div className="footer-bottom">
        <p>© 2026 EduFlow. All rights reserved.</p>
      </div>
    </footer>
  );
}
