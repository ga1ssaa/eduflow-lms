import { Link } from 'react-router-dom';
import type { User } from '../lib/types';
import './footer.css';

interface FooterProps {
  user: Pick<User, 'role'> | null;
  showNavigation?: boolean;
}

export function Footer({ user, showNavigation = true }: FooterProps) {
  return (
    <footer className="site-footer">
      <span>EduFlow</span>
      {showNavigation && (
        <nav aria-label="Footer navigation">
          <Link to="/courses">Explore courses</Link>
          <Link
            to={
              user
                ? user.role === 'student'
                  ? '/learning'
                  : user.role === 'admin'
                    ? '/admin'
                    : '/instructor'
                : '/login'
            }
          >
            {user ? 'Your workspace' : 'Sign in'}
          </Link>
        </nav>
      )}
      <span>A clear path to your next skill.</span>
      <section
        className="footer-contact"
        aria-labelledby="footer-contact-title"
      >
        <h2 id="footer-contact-title">Contact &amp; Support</h2>
        <div className="footer-contact-links">
          <a
            href="mailto:support@eduflow.example"
            aria-describedby="footer-contact-note"
          >
            Contact Support
          </a>
          <a
            href="mailto:support@eduflow.example"
            aria-describedby="footer-contact-note"
          >
            support@eduflow.example
          </a>
        </div>
        <p id="footer-contact-note" className="footer-contact-note">
          Demo address, not a functioning support inbox.
        </p>
      </section>
    </footer>
  );
}
