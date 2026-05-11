import { Outlet } from "react-router";

import { Loader } from "@/components/Loader";
import { NavBar } from "@/components/NavBar";
import {
  getAuthSignInHref,
  getAuthSignOutHref,
  getAuthSignUpHref,
} from "@/constants/authUrls";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";
import { formatUserDisplayName } from "@/lib/userDisplayName";

// Reads `/me` so an authenticated user landing on a public page
// sees the authed navbar — avoids an anonymous→authed flicker
// when the back button lands here from `/app`.

const LoggedOutPageLayout = () => {
  const { isAuthenticated, user, status } = useGetCurrentUser();

  if (status === "pending") {
    return <Loader />;
  }

  const userDisplayName =
    isAuthenticated && user ? formatUserDisplayName(user) : undefined;
  const userEmail =
    isAuthenticated && user ? (user.email ?? undefined) : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar
        signInHref={getAuthSignInHref()}
        signUpHref={getAuthSignUpHref()}
        signOutHref={getAuthSignOutHref()}
        isAuthenticated={isAuthenticated}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
      />
      <main className="flex w-full flex-1 flex-col p-4">
        <Outlet />
      </main>
    </div>
  );
};

export default LoggedOutPageLayout;
