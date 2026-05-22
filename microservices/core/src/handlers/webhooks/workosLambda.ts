// Production Lambda wrapper for the WorkOS webhook routing handler.
//
// Slice 1 / T-016. This file is pure wiring — it constructs the
// production deps shape (Drizzle client, WorkOS SDK client, repos,
// pre-bound application-handler routes) and hands it to
// `routeWorkOSWebhook`. The routing logic itself is in `workos.ts`
// where it gets unit-tested with mocked deps.
//
// Excluded from the unit-coverage gate (see
// `microservices/core/vitest.config.ts`) for the same reason
// `src/api.ts` is: a unit test here would just assert that we pass
// the constructed objects through unchanged. The dep-construction
// surface is exercised by deploy + the `bun sst diff` guardrail
// before any infra change ships.

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";
import { injectLambdaContext } from "@ai-data-room/api-utils/logging";

import { logger } from "../../infrastructure/logging/logger";
import { flushMetrics } from "../../infrastructure/observability/metrics";

import { acceptInvitation } from "../../application/invitations";
import { handlePasswordResetCompleted } from "../../application/password-reset";
import { handleUserDeleted } from "../../application/deletion";
import { AuditRepo } from "../../infrastructure/db/auditRepo";
import { ExternalGrantRepo } from "../../infrastructure/db/externalGrantRepo";
import { InvitationRepo } from "../../infrastructure/db/invitationRepo";
import { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import { UserRepo } from "../../infrastructure/db/userRepo";
import { WebhookDeliveryRepo } from "../../infrastructure/db/webhookDeliveryRepo";
import { createWorkOSClient } from "../../infrastructure/workos/client";
import { verifyWorkOSWebhook } from "../../infrastructure/workos/webhook";

import { routeWorkOSWebhook } from "./workos";

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  injectLambdaContext(logger, context);

  const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
  const workos = createWorkOSClient({
    apiKey: Resource.WORKOS_API_KEY.value,
    clientId: Resource.WORKOS_CLIENT_ID.value,
  });

  const userRepo = new UserRepo(db);
  const auditRepo = new AuditRepo(db);
  const membershipRepo = new MembershipRepo(db);
  const externalGrantRepo = new ExternalGrantRepo(db);
  const invitationRepo = new InvitationRepo(db);
  const webhookRepo = new WebhookDeliveryRepo(db);

  try {
    return await routeWorkOSWebhook(event, {
      webhookSecret: Resource.WORKOS_WEBHOOK_SECRET.value,
      webhookRepo,
      verify: verifyWorkOSWebhook,
      routes: {
        userDeleted: (input) =>
          handleUserDeleted(input, { userRepo, auditRepo }),
        passwordResetCompleted: (input) =>
          handlePasswordResetCompleted(input, { workos, userRepo, auditRepo }),
        invitationAccepted: (input) =>
          acceptInvitation(input, {
            db,
            userRepo,
            membershipRepo,
            externalGrantRepo,
            invitationRepo,
            auditRepo,
          }),
      },
    });
  } finally {
    flushMetrics();
  }
}
