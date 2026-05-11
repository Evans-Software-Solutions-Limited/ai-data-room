import { Link } from "react-router";

import { getAuthSignInHref } from "@/constants/authUrls";

// Per ADR-003 we never see plaintext recovery codes — AuthKit's
// hosted enrolment screen owns view + download. This page exists
// only so a stale `/mfa` link resolves to a useful explanation
// rather than a 404.

const Mfa = () => {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Multi-factor authentication</h1>
      <p className="text-muted-foreground">
        Recovery-code view and download are handled by the hosted AuthKit
        enrolment screen during sign-up and on subsequent sign-ins until MFA is
        enrolled. There is no plaintext-codes UI here — see ADR-003.
      </p>
      <p className="text-sm">
        <a href={getAuthSignInHref()} className="underline">
          Sign in to enrol
        </a>
        {" · "}
        <Link to="/app" className="underline">
          Back to your workspace
        </Link>
      </p>
    </section>
  );
};

export default Mfa;
