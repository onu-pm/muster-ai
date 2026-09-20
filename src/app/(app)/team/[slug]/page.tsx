import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/data/session';
import { getTeammateWithState } from '@/lib/data/team';
import { listConnections } from '@/lib/data/connections';
import { listRules } from '@/lib/data/rules';
import { listFacts, listDeadlines, listPeople } from '@/lib/data/knowledge';
import { listActivity } from '@/lib/data/activity';
import { requiredCategories } from '@/lib/catalog/team-agents';
import { PROVIDERS, CATEGORY_LABELS } from '@/lib/catalog/providers';
import { ProviderCard } from '@/components/ProviderCard';
import { RulesTab } from '@/components/RulesTab';
import { ActivityTab } from '@/components/ActivityTab';
import {
  formatDate,
  formatMoney,
  jurisdictionLabel,
  personTypeLabel,
  ruleDescription,
  ruleLabel,
  ruleScopeLabel,
  taxRegimeLabel,
} from '@/lib/copy/labels';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'sources', label: 'Data sources' },
  { key: 'rules', label: 'Rules' },
  { key: 'knows', label: 'What Holly knows' },
  { key: 'activity', label: 'Activity' },
] as const;

export default async function TeammatePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: rawTab } = await searchParams;
  const { org } = await requireWorkspace();

  const mate = await getTeammateWithState(org.id, slug);
  if (!mate || !mate.active) notFound();

  const tab = TABS.some((t) => t.key === rawTab) ? rawTab! : 'overview';
  const tabLabel = (key: string) =>
    TABS.find((t) => t.key === key)?.label ?? key;

  return (
    <>
      <header className="row" style={{ gap: 16, marginBottom: 26 }}>
        <span className="avatar avatar-lg">{mate.initial}</span>
        <div style={{ minWidth: 0 }}>
          <h1>{mate.name}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>
            {mate.role}
          </p>
        </div>
      </header>

      <nav className="tabBar" aria-label={`${mate.name} sections`}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/team/${mate.key}?tab=${t.key}`}
            className="tab"
            data-active={tab === t.key}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <h2 className="eyebrow" style={{ marginBottom: 14 }}>
        {tabLabel(tab)}
      </h2>

      {tab === 'overview' ? <Overview mate={mate} /> : null}
      {tab === 'sources' ? <Sources orgId={org.id} mate={mate} /> : null}
      {tab === 'rules' ? <Rules orgId={org.id} mateName={mate.name} /> : null}
      {tab === 'knows' ? <Knows orgId={org.id} mateName={mate.name} /> : null}
      {tab === 'activity' ? <Activity orgId={org.id} /> : null}
    </>
  );
}

/* ---------------- Overview ---------------- */

function Overview({
  mate,
}: {
  mate: Awaited<ReturnType<typeof getTeammateWithState>> & object;
}) {
  const visible = mate.agents.filter((a) => !a.internal);
  const behind = mate.agents.filter((a) => a.internal);

  return (
    <>
      <p style={{ fontSize: 15, lineHeight: 1.65, maxWidth: '64ch' }}>
        {mate.about}
      </p>

      <div className="grid-3" style={{ marginTop: 24 }}>
        {visible.map((agent) => (
          <div key={agent.key} className="card">
            <div className="cardTitle">{agent.name}</div>
            <p className="cardBody" style={{ marginTop: 8 }}>
              {agent.oneLiner}
            </p>
          </div>
        ))}
      </div>

      {behind.length > 0 ? (
        <div className="card-flat" style={{ marginTop: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Also behind the scenes
          </div>
          {behind.map((agent) => (
            <p key={agent.key} className="small muted">
              <span className="strong" style={{ color: 'var(--text)' }}>
                {agent.name}.
              </span>{' '}
              {agent.oneLiner}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ---------------- Data sources ---------------- */

async function Sources({
  orgId,
  mate,
}: {
  orgId: string;
  mate: NonNullable<Awaited<ReturnType<typeof getTeammateWithState>>>;
}) {
  const connections = await listConnections(orgId);
  const categories = requiredCategories(mate);

  return (
    <div className="stack-lg">
      {categories.map((category) => (
        <section key={category}>
          <div className="sectionHead">
            <div className="sectionTitle">{CATEGORY_LABELS[category]}</div>
          </div>
          <div className="grid-2">
            {PROVIDERS.filter((p) => p.category === category).map((provider) => (
              <ProviderCard
                key={provider.key}
                provider={provider}
                connection={
                  connections.find((c) => c.providerKey === provider.key) ?? null
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Rules ---------------- */

async function Rules({
  orgId,
  mateName,
}: {
  orgId: string;
  mateName: string;
}) {
  const rules = await listRules(orgId);
  const confirmed = rules.filter((r) => r.confirmed);
  const waiting = rules.filter((r) => !r.confirmed);

  return (
    <RulesTab
      mateName={mateName}
      confirmed={confirmed.map((r) => ({
        id: r.id,
        label: ruleLabel(r.ruleKey, r.label),
        description: ruleDescription(r.ruleKey, r.source),
        scope: ruleScopeLabel(r.scope),
        where: jurisdictionLabel(r.jurisdiction),
        from: formatDate(r.effectiveFrom),
      }))}
      waitingCount={waiting.length}
    />
  );
}

/* ---------------- What Holly knows ---------------- */

async function Knows({
  orgId,
  mateName,
}: {
  orgId: string;
  mateName: string;
}) {
  const [people, rules, deadlines, facts] = await Promise.all([
    listPeople(orgId),
    listRules(orgId),
    listDeadlines(orgId),
    listFacts(orgId),
  ]);

  const confirmed = rules.filter((r) => r.confirmed);

  return (
    <div className="stack-lg">
      <KnowSection
        title="Structure"
        empty={`${mateName} has no salary structures on record yet.`}
        count={people.length}
      >
        {people.map((person) => {
          const total = Object.values(person.salaryStructure).reduce(
            (sum, v) => sum + (typeof v === 'number' ? v : 0),
            0,
          );
          return (
            <div key={person.id} className="listRow">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong">{person.fullName}</div>
                <div className="tiny muted">
                  {personTypeLabel(person.type)}
                  {person.taxRegime
                    ? ` · ${taxRegimeLabel(person.taxRegime)}`
                    : ''}
                  {person.doj ? ` · joined ${formatDate(person.doj)}` : ''}
                </div>
              </div>
              <span className="small strong">
                {total > 0 ? `${formatMoney(total)} a month` : '—'}
              </span>
            </div>
          );
        })}
      </KnowSection>

      <KnowSection
        title="Rules"
        empty="No rules confirmed yet. Paste a calculation sheet on the Rules tab."
        count={confirmed.length}
      >
        {confirmed.map((rule) => (
          <div key={rule.id} className="listRow">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="strong">{ruleLabel(rule.ruleKey, rule.label)}</div>
              <div className="tiny muted">
                {rule.source ?? 'Confirmed by you'} ·{' '}
                {jurisdictionLabel(rule.jurisdiction)}
              </div>
            </div>
            <span className="tiny muted">
              from {formatDate(rule.effectiveFrom)}
            </span>
          </div>
        ))}
      </KnowSection>

      <KnowSection
        title="Calendar"
        empty="No statutory dates on record for this organisation yet."
        count={deadlines.length}
      >
        {deadlines.map((deadline) => (
          <div key={deadline.id} className="listRow">
            <div className="grow">
              <div className="strong">{formatDate(deadline.date)}</div>
              <div className="tiny muted">
                {deadline.recurrence ?? 'One off'}
                {deadline.owner ? ` · ${deadline.owner}` : ''}
              </div>
            </div>
          </div>
        ))}
      </KnowSection>

      <KnowSection
        title="Learned facts"
        empty={`Nothing learned yet. When you correct ${mateName}, what she learns lands here.`}
        count={facts.length}
      >
        {facts.map((fact) => (
          <div key={fact.id} className="listRow">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small">{fact.statement}</div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {fact.evidenceLine ?? 'Recorded by Holly'} ·{' '}
                {formatDate(fact.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </KnowSection>
    </div>
  );
}

function KnowSection({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="sectionHead">
        <div className="sectionTitle">{title}</div>
        {count > 0 ? <span className="tiny muted">{count}</span> : null}
      </div>
      {count === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <div className="card" style={{ padding: '4px 20px' }}>
          {children}
        </div>
      )}
    </section>
  );
}

/* ---------------- Activity ---------------- */

async function Activity({ orgId }: { orgId: string }) {
  const entries = await listActivity(orgId);
  return <ActivityTab entries={entries} />;
}
