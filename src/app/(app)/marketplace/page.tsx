import {
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  providersInCategory,
} from '@/lib/catalog/providers';
import { ProviderCard } from '@/components/ProviderCard';
import { listConnections } from '@/lib/data/connections';
import { requireWorkspace } from '@/lib/data/session';

export default async function MarketplacePage() {
  const { org } = await requireWorkspace();
  const connections = await listConnections(org.id);

  return (
    <>
      <header className="pageHeader">
        <h1>Connect your data.</h1>
        <p className="sub">
          Your team works from the records you already keep. Connect a source and
          they start using it straight away.
        </p>
      </header>

      <div className="stack-lg">
        {CATEGORY_ORDER.map((category) => (
          <section key={category}>
            <div className="sectionHead">
              <div>
                <div className="sectionTitle">{CATEGORY_LABELS[category]}</div>
                <p className="tiny muted" style={{ marginTop: 2 }}>
                  {CATEGORY_BLURBS[category]}
                </p>
              </div>
            </div>

            <div className="grid-2">
              {providersInCategory(category).map((provider) => (
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
    </>
  );
}
