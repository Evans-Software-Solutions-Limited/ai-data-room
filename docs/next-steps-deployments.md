# Next Steps: Pre-Production and Production Deployments

This document outlines what’s left to implement for pre-production and production deployments, and what you need to configure in **GitHub** and **AWS** (including secrets and OIDC).

---

## Current State

Already in place:

- **PR checks** (`pr-checks.yml`) – typecheck, lint, prettier, build, unit tests on every PR.
- **PR environment** (`pr-environment.yml`) – deploys to `pr-{number}` when the `ready-for-test` label is added.
- **Destroy PR env** (`destroy-pr-env.yml`) – tears down `pr-{number}` when the PR is closed or the label is removed.

Pre-production and production workflows are **not** created yet. The sections below describe what to add and how to configure GitHub and AWS.

---

## 1. GitHub Configuration

### 1.1 Secrets (per environment)

Configure these in **Settings → Secrets and variables → Actions** (repository or environment).

| Secret                    | Used by                    | Description                                                                |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `AWS_ROLE_ARN_PR`         | PR deploy, destroy PR env  | IAM role ARN for the **PR** AWS account (already referenced in workflows). |
| `AWS_ROLE_ARN_PREPROD`    | Preprod deploy (to add)    | IAM role ARN for the **pre-production** AWS account.                       |
| `AWS_ROLE_ARN_PRODUCTION` | Production deploy (to add) | IAM role ARN for the **production** AWS account.                           |

**Optional (if you use environment-specific secrets):**

- Create GitHub **environments**: e.g. `preprod`, `production`.
- Store the role ARN for each in that environment’s secrets (e.g. `AWS_ROLE_ARN` in the `preprod` and `production` environments).

### 1.2 Variables (optional)

| Variable     | Used by              | Description                                                                         |
| ------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `AWS_REGION` | All deploy workflows | AWS region (e.g. `eu-west-2`). Workflows currently default to `eu-west-2` if unset. |

Set in **Settings → Secrets and variables → Actions → Variables** (or per-environment if you use environments).

---

## 2. AWS Configuration

You need **one AWS account (or more)** depending on how you split PR / preprod / production. For each account that GitHub Actions will deploy into:

### 2.1 OIDC identity provider (once per account)

1. In **IAM → Identity providers**, add an **OpenID Connect** provider:
   - **Provider URL**: `https://token.actions.githubusercontent.com`
   - **Audience**: `sts.amazonaws.com` (default).

2. This lets GitHub Actions request short-lived credentials without storing long-lived keys in GitHub.

### 2.2 IAM role and trust policy (per account / environment)

Create an IAM role that GitHub Actions will assume (e.g. `github-actions-pr`, `github-actions-preprod`, `github-actions-production`).

**Trust policy** (example for a **single repo** and **main** for preprod):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:*"
        }
      }
    }
  ]
}
```

- Replace `<ACCOUNT_ID>`, `<ORG>`, `<REPO>` with your AWS account ID and GitHub org/repo.
- For **production**, tighten `:sub` (e.g. only allow `ref:refs/heads/main` or a specific environment).
- For **PR**, you can restrict to `pull_request` or branch refs if needed.

### 2.3 Permissions (role policy)

The role needs permissions for whatever SST deploys (e.g. CloudFormation, Lambda, API Gateway, S3, CloudFront, IAM for roles used by Lambdas). Options:

- **Quick start**: Attach a broad policy (e.g. `AdministratorAccess`) for the role, then narrow later.
- **Least privilege**: Create a custom policy that only allows the resources and actions SST uses in that account.

### 2.4 Summary per environment

| Environment    | Account           | OIDC provider             | IAM role                         | GitHub secret             |
| -------------- | ----------------- | ------------------------- | -------------------------------- | ------------------------- |
| PR             | e.g. Dev / shared | Yes (if separate account) | e.g. `github-actions-pr`         | `AWS_ROLE_ARN_PR`         |
| Pre-production | Preprod account   | Yes                       | e.g. `github-actions-preprod`    | `AWS_ROLE_ARN_PREPROD`    |
| Production     | Prod account      | Yes                       | e.g. `github-actions-production` | `AWS_ROLE_ARN_PRODUCTION` |

If PR and preprod share an account, you can use one OIDC provider and one or two roles; each workflow assumes the correct role ARN from secrets.

---

## 3. Workflows to Add

### 3.1 Pre-production deploy

- **Trigger**: Push to `main` (or merge to `main`).
- **Steps**: Checkout → Setup (Bun) → Build → Configure AWS (using preprod role) → `sst deploy --stage preprod` (or your chosen stage name).
- **Secrets/vars**: `AWS_ROLE_ARN_PREPROD`, optionally `AWS_REGION`.

### 3.2 Production deploy (with Release Please)

- **Trigger**: When a **Release Please** “chore” (or release) is merged, or when a release is published.
- **Steps**: Checkout → Setup → Build → Configure AWS (using production role) → `sst deploy --stage production`.
- **Secrets/vars**: `AWS_ROLE_ARN_PRODUCTION`, optionally `AWS_REGION`.

Release Please setup (separate from this doc):

- Add Release Please config (e.g. `.release-please-config.json`, `release-please` manifest).
- Use chore/release PRs so that production deploys only after an explicit “release” merge.

---

## 4. Checklist

Use this as a running list.

### GitHub

- [ ] Create repository (or environment) **secrets**:
  - [ ] `AWS_ROLE_ARN_PR` (if not already set)
  - [ ] `AWS_ROLE_ARN_PREPROD`
  - [ ] `AWS_ROLE_ARN_PRODUCTION`
- [ ] Optionally set **variable** `AWS_REGION`.
- [ ] Optionally create **environments** `preprod` and `production` and attach secrets there.
- [ ] Configure **branch protection** for `main` so that PR checks must pass before merge.

### AWS (per account used by GitHub)

- [ ] Add **OIDC identity provider** for `https://token.actions.githubusercontent.com`.
- [ ] Create **IAM role** for PR (if not done): trust policy for `repo:<ORG>/<REPO>`, attach permissions.
- [ ] Create **IAM role** for preprod: trust policy, attach permissions; copy ARN into `AWS_ROLE_ARN_PREPROD`.
- [ ] Create **IAM role** for production: trust policy (stricter if desired), attach permissions; copy ARN into `AWS_ROLE_ARN_PRODUCTION`.

### Repo (when you implement)

- [ ] Add workflow: **pre-production deploy** on push to `main`.
- [ ] Add workflow: **production deploy** (triggered by Release Please or release event).
- [ ] Optionally add **Release Please** config and docs.

---

## 5. Stage Names and Accounts (reference)

Align these with your workflows and SST stages:

| Stage name    | When used       | Typical account    |
| ------------- | --------------- | ------------------ |
| `pr-{number}` | PR env deploy   | Dev / PR account   |
| `preprod`     | Merge to main   | Preprod account    |
| `production`  | Release / chore | Production account |

Your `sst.config.ts` already uses `input?.stage` (e.g. for removal and protection); keep using these stage names in `sst deploy --stage <name>` and `sst remove --stage <name>` so behaviour stays consistent.

---

## 6. Where to Get the Role ARNs

After creating each IAM role in AWS:

1. Open **IAM → Roles** and select the role.
2. Copy the **Role ARN** (e.g. `arn:aws:iam::123456789012:role/github-actions-preprod`).
3. Paste into the corresponding GitHub secret (`AWS_ROLE_ARN_PR`, `AWS_ROLE_ARN_PREPROD`, or `AWS_ROLE_ARN_PRODUCTION`).

No access keys are required when using OIDC; the workflows use `aws-actions/configure-aws-credentials@v4` with `role-to-assume`.
