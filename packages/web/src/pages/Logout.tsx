import { useEffect } from "react";

import { getAuthSignOutHref } from "@/constants/authUrls";

const Logout = () => {
  useEffect(() => {
    window.location.assign(getAuthSignOutHref());
  }, []);

  return <p>Signing out…</p>;
};

export default Logout;
