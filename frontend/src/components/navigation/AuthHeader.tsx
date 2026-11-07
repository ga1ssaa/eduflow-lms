import { ArrowLeft, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeControl } from '../../theme/ThemeControl';

export function AuthHeader() {
  return (
    <header className="auth-header">
      <Link className="auth-brand" to="/" aria-label="EduFlow home">
        <GraduationCap size={28} aria-hidden="true" />
        EduFlow
      </Link>
      <nav
        className="auth-header-actions"
        aria-label="Authentication navigation"
      >
        <Link className="auth-back" to="/" aria-label="Back to Home">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to Home</span>
        </Link>
        <ThemeControl />
      </nav>
    </header>
  );
}
