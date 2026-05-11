import { useEffect } from "react";

import { getAuthSignInHref } from "@/constants/authUrls";

// `window.location.assign` rather than a React Router transition —
// the `/auth/sign-in` → AuthKit → `/auth/callback` chain ends with
// a `Set-Cookie` for the sealed session, which only lands on a real
// browser navigation. Same applies to Signup and Logout.

const Login = () => {
  useEffect(() => {
    window.location.assign(getAuthSignInHref());
  }, []);

  return <p>Redirecting to sign in…</p>;
};

export default Login;
