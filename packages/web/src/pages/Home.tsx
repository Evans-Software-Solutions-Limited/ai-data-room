import { Link } from "react-router";

import { getAuthSignInHref, getAuthSignUpHref } from "@/constants/authUrls";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";

const Home = () => {
  const { isAuthenticated } = useGetCurrentUser();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">AI Data Room</h1>
      <p className="text-muted-foreground">
        Secure, AI-native data rooms for diligence workflows.
      </p>
      <div className="flex gap-4">
        {isAuthenticated ? (
          <Link to="/app" className="underline">
            Go to your workspace
          </Link>
        ) : (
          <>
            <a href={getAuthSignInHref()} className="underline">
              Sign in
            </a>
            <a href={getAuthSignUpHref()} className="underline">
              Sign up
            </a>
          </>
        )}
      </div>
    </div>
  );
};

export default Home;
