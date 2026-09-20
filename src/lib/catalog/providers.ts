export type ProviderCategory = 'people_data' | 'messaging' | 'government';

export type ConnectFormKind = 'token' | 'upload' | 'none';

export interface ProviderField {
  name: string;
  label: string;
  placeholder: string;
  hint?: string;
  secret?: boolean;
}

export interface Provider {
  key: string;
  label: string;
  category: ProviderCategory;
  description: string;
  usedBy: string;
  available: boolean;
  connectForm: ConnectFormKind;
  fields: ProviderField[];
  /** Shown on the card when the provider isn't connectable yet. */
  comingSoonNote?: string;
}

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  people_data: 'People & attendance data',
  messaging: 'Messaging',
  government: 'Government & statutory',
};

export const CATEGORY_BLURBS: Record<ProviderCategory, string> = {
  people_data:
    'Where your people, their leave and their attendance already live.',
  messaging: 'How your team reaches people when something needs an answer.',
  government: 'Statutory portals Holly files to and reconciles against.',
};

export const CATEGORY_ORDER: ProviderCategory[] = [
  'people_data',
  'messaging',
  'government',
];

export const PROVIDERS: Provider[] = [
  {
    // Matches the provider_key already present in this project's connections table.
    key: 'remote_com',
    label: 'Remote.com',
    category: 'people_data',
    description:
      'Pulls your people, their leave and their time off straight from Remote.',
    usedBy: 'Holly',
    available: true,
    connectForm: 'token',
    fields: [
      {
        name: 'token',
        label: 'Remote API token',
        placeholder: 'ra_test_…',
        hint: 'Use a sandbox token while you are trying things out.',
        secret: true,
      },
    ],
  },
  {
    key: 'csv_import',
    label: 'Spreadsheet import',
    category: 'people_data',
    description:
      'Upload a monthly attendance sheet as a CSV. Good when your records live in a spreadsheet.',
    usedBy: 'Holly',
    available: true,
    connectForm: 'none',
    fields: [],
  },
  {
    key: 'darwinbox',
    label: 'Darwinbox',
    category: 'people_data',
    description: 'Sync people and leave records from Darwinbox.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
  {
    key: 'keka',
    label: 'Keka',
    category: 'people_data',
    description: 'Sync people and attendance from Keka.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
  {
    key: 'zoho_people',
    label: 'Zoho People',
    category: 'people_data',
    description: 'Sync people and leave balances from Zoho People.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp for Business',
    category: 'messaging',
    description:
      'Lets Holly chase a missing proof or an unexplained absence directly with the person.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote:
      'Holly drafts these messages today, but nothing is sent until a channel is connected.',
  },
  {
    key: 'slack',
    label: 'Slack',
    category: 'messaging',
    description: 'Post approvals and reminders into a channel your team watches.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
  {
    key: 'email_outbound',
    label: 'Email',
    category: 'messaging',
    description: 'Send payslips and reminders from your own domain.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
  {
    key: 'epfo',
    label: 'EPFO',
    category: 'government',
    description: 'Provident fund filings and challan reconciliation.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Holly calculates these figures, but cannot file them yet.',
  },
  {
    key: 'esic',
    label: 'ESIC',
    category: 'government',
    description: 'Employee state insurance contributions and filings.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Holly calculates these figures, but cannot file them yet.',
  },
  {
    key: 'traces',
    label: 'Income Tax TRACES',
    category: 'government',
    description: 'Quarterly TDS returns and Form 16 generation.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Holly projects TDS monthly, but cannot file returns yet.',
  },
  {
    key: 'pt_portal',
    label: 'Professional Tax portals',
    category: 'government',
    description: 'State-by-state professional tax payments and returns.',
    usedBy: 'Holly',
    available: false,
    connectForm: 'token',
    fields: [],
    comingSoonNote: 'Not built yet.',
  },
];

export function getProvider(key: string): Provider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export function providersInCategory(category: ProviderCategory): Provider[] {
  return PROVIDERS.filter((p) => p.category === category);
}

export function providerLabel(key: string): string {
  return getProvider(key)?.label ?? key;
}
