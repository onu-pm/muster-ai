import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { listConnections } from '@/lib/data/connections';

/**
 * Pursue — following up with a person.
 *
 * A stub, deliberately. There is no WhatsApp Business account behind this, so
 * nothing is ever sent. The intent is drafted and recorded so the trail is
 * honest, and the result says plainly that it went nowhere.
 *
 * When a messaging channel is connected this is where it plugs in; until then
 * `sent` is always false and no caller may report otherwise.
 */

export interface PursueRequest {
  orgId: string;
  dutyInstanceId: string;
  personName: string;
  reason: string;
}

export interface PursueResult {
  sent: false;
  drafted: string;
  /** Why it was not sent, in words a person can read. */
  blockedBecause: string;
}

export async function pursue(request: PursueRequest): Promise<PursueResult> {
  const connections = await listConnections(request.orgId);
  const channel = connections.find(
    (c) =>
      c.status === 'connected' &&
      ['whatsapp', 'slack', 'email_outbound'].includes(c.providerKey),
  );

  const drafted =
    `Hi ${request.personName.split(/\s+/)[0]}, ` +
    `${request.reason} Could you sort this out before payroll closes? Thanks.`;

  const blockedBecause = channel
    ? 'A channel is connected, but sending is not built yet.'
    : 'No messaging channel is connected, so nothing was sent.';

  await createAdminClient()
    .from('steps')
    .insert({
      duty_instance_id: request.dutyInstanceId,
      capability: 'explain',
      input: { personName: request.personName, reason: request.reason },
      output: {
        summary: `Drafted a follow-up to ${request.personName}. Not sent — ${blockedBecause.toLowerCase()}`,
        drafted,
        sent: false,
      },
      at: new Date().toISOString(),
    });

  return { sent: false, drafted, blockedBecause };
}
