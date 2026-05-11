import { Navigate, Outlet } from "react-router";

import { Loader } from "@/components/Loader";
import { NavBar } from "@/components/NavBar";
import {
  getAuthSignInHref,
  getAuthSignOutHref,
  getAuthSignUpHref,
} from "@/constants/authUrls";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";
import { formatUserDisplayName } from "@/lib/userDisplayName";

const LoggedInPageLayout = () => {
  const { isAuthenticated, user, status } = useGetCurrentUser();

  if (status === "pending") {
    return <Loader />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar
        signInHref={getAuthSignInHref()}
        signUpHref={getAuthSignUpHref()}
        signOutHref={getAuthSignOutHref()}
        isAuthenticated
        userDisplayName={formatUserDisplayName(user)}
        userEmail={user.email ?? undefined}
      />
      <main className="flex w-full flex-1 flex-col p-4">
        <Outlet />
      </main>
    </div>
  );
};

export default LoggedInPageLayout;
