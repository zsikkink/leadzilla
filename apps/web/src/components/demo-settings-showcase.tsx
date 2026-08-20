import {
  DEMO_SETTINGS_SNAPSHOT,
  type DemoSettingsSectionId,
} from '../lib/demo-settings-snapshot.js';

function SettingsSection({ sectionId }: { sectionId: DemoSettingsSectionId }) {
  const section = DEMO_SETTINGS_SNAPSHOT.sections.find(({ id }) => id === sectionId);

  if (!section) return null;

  return (
    <section className="border-b border-border/50 py-7 first:pt-0 last:border-0">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{section.description}</p>
      </div>

      <dl className="mt-5 divide-y divide-border/40 border-y border-border/40">
        {section.items.map((item) => (
          <div
            key={item.label}
            className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,auto)] sm:items-center sm:gap-8"
          >
            <div className="min-w-0">
              <dt className="text-sm font-medium text-foreground">{item.label}</dt>
              <dd className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</dd>
            </div>
            <dd className="text-sm font-medium text-foreground sm:text-right">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DemoSettingsShowcase() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="border-b border-border/50 pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-foreground">Workspace settings</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Company-wide timing, review, safety, and scoring policies. ICP-specific targeting and qualification signals remain with each profile.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Demo configuration · Read only</span>
        </div>

        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {DEMO_SETTINGS_SNAPSHOT.summary.map((item) => (
            <div key={item.label}>
              <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{item.value}</dd>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </dl>
      </div>

      <section className="border-b border-border/50 py-7">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-foreground">Follow-up sequence</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Three considered follow-ups after the approved first touch, spaced across two weeks.
          </p>
        </div>

        <ol className="mt-5 divide-y divide-border/40 border-y border-border/40">
          {DEMO_SETTINGS_SNAPSHOT.followUps.map((step, index) => (
            <li
              key={step.label}
              className="grid gap-2 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_8rem] sm:items-center sm:gap-4"
            >
              <span className="text-xs font-medium text-muted-foreground">{index + 1}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.purpose}</p>
              </div>
              <span className="text-sm text-foreground sm:text-right">{step.timing}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground">Sequence stops automatically when</p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {DEMO_SETTINGS_SNAPSHOT.stopConditions.map((condition) => (
              <li key={condition} className="text-sm text-foreground">{condition}</li>
            ))}
          </ul>
        </div>
      </section>

      {DEMO_SETTINGS_SNAPSHOT.sections.map((section) => (
        <SettingsSection key={section.id} sectionId={section.id} />
      ))}
    </div>
  );
}
