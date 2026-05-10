import { Link } from "react-router";

// Auth actions are plain `<a>` anchors (not React Router `<Link>`s)
// because the hrefs point at backend redirect routes that need a
// full-page navigation to land the sealed-session cookie.

export interface NavBarProps {
  signInHref: string;
  signOutHref: string;
  signUpHref: string;
  isAuthenticated: boolean;
  userDisplayName?: string;
  userEmail?: string;
}

export function NavBar({
  signInHref,
  signOutHref,
  signUpHref,
  isAuthenticated,
  userDisplayName,
  userEmail,
}: NavBarProps) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link to="/" className="font-semibold">
        AI Data Room
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {isAuthenticated ? (
          <>
            <span className="text-muted-foreground">
              {userDisplayName ?? userEmail}
            </span>
            <a href={signOutHref} className="underline">
              Sign out
            </a>
          </>
        ) : (
          <>
            <a href={signInHref} className="underline">
              Sign in
            </a>
            <a href={signUpHref} className="underline">
              Sign up
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
