import { useEffect } from "react";

import { getAuthSignUpHref } from "@/constants/authUrls";

const Signup = () => {
  useEffect(() => {
    window.location.assign(getAuthSignUpHref());
  }, []);

  return <p>Redirecting to sign up…</p>;
};

export default Signup;
