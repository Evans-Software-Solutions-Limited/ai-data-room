import { Link } from "react-router";

import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";

// `/me` returns `orgId: null` for users who completed signup but
// haven't been provisioned into an org yet — slice 9
// (`onboarding-flow`) provides the real org-creation surface; until
// then we explain the gap rather than 404.

const AppWorkspace = () => {
  const { user } = useGetCurrentUser();

  if (!user) return null;

  if (!user.orgId) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Welcome to AI Data Room</h1>
        <p className="text-muted-foreground">
          You're signed in, but your account isn't attached to an organisation
          yet. Org provisioning lands in the onboarding flow (slice 9) — until
          then there's no workspace to show.
        </p>
        <p className="text-sm">
          <Link to="/" className="underline">
            Back to the landing page
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{user.orgName ?? "Workspace"}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">User ID</dt>
        <dd>{user.userId}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd>{user.email}</dd>
        <dt className="text-muted-foreground">Role</dt>
        <dd>{user.role}</dd>
        <dt className="text-muted-foreground">Org ID</dt>
        <dd>{user.orgId}</dd>
        <dt className="text-muted-foreground">MFA enrolled</dt>
        <dd>{user.mfaEnrolled ? "yes" : "no"}</dd>
        <dt className="text-muted-foreground">Lifecycle state</dt>
        <dd>{user.lifecycleState}</dd>
        {user.opportunityScopes.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Opportunity scopes</dt>
            <dd>{user.opportunityScopes.join(", ")}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
};

export default AppWorkspace;
