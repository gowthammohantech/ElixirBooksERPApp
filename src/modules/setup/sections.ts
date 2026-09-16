// The Setup hub's card model — one source for the All Settings page, the sidebar's setup navigation
// and the command palette. Link ids are full route paths; every existing admin / masters / platform
// page is reachable from here, gated the same way the module sub-navs gate them.
import { useMemo, type ComponentType } from 'react';
import { nav, useSession, type Scope } from '../../store';
import {
  BuildingIcon, UsersIcon, CogIcon, PercentIcon, EditIcon, ZapIcon, ReceiptIcon, ShoppingCartIcon, PackageIcon, BookOpenIcon,
  CreditCardIcon, FileTextIcon, FactoryIcon, MonitorIcon, WalletIcon, LinkIcon, DatabaseIcon, ShieldCheckIcon,
} from '../../components/Icons';
import { adminNav, MASTERS_NAV, MODULE_SETTINGS, PLATFORM_NAV } from '../subnav';
import { visibleModuleIds } from '../registry';

export type SetupTone = 'accent' | 'good' | 'warn' | 'danger' | 'info' | 'violet' | 'neutral';
export interface SetupLink { id: string; label: string; keywords?: string }
export interface SetupCard { id: string; title: string; icon: ComponentType<{ size?: number }>; tone: SetupTone; links: SetupLink[] }
export interface SetupSection { id: 'organization' | 'modules' | 'developer'; title: string; cards: SetupCard[] }

const MODULE_TONES: SetupTone[] = ['good', 'danger', 'info', 'accent', 'violet', 'warn'];

export function setupSections(s: Scope, visibleModules: string[]): SetupSection[] {
  const admin = adminNav(s);
  const a = (id: string): SetupLink[] => {
    const i = admin.find((x) => x.id === id);
    return i && !i.hidden ? [{ id: `admin/${i.id}`, label: i.label }] : [];
  };
  const mastersOk = visibleModules.includes('masters');
  const m = (id: string): SetupLink[] => {
    const i = MASTERS_NAV.find((x) => x.id === id);
    return mastersOk && i ? [{ id: `masters/${i.id}`, label: i.label }] : [];
  };
  const ms = (mod: string): SetupLink[] => {
    const p = MODULE_SETTINGS.find((x) => x.module === mod);
    return p && visibleModules.includes(mod) ? [{ id: p.id, label: p.label }] : [];
  };
  const card = (id: string, title: string, icon: SetupCard['icon'], tone: SetupTone, links: SetupLink[]): SetupCard[] =>
    links.length ? [{ id, title, icon, tone, links }] : [];

  const organization: SetupCard[] = [
    ...card('org', 'Organization', BuildingIcon, 'accent', [...a('company'), ...a('profile'), ...a('branches'), ...a('companies'), ...a('plan'), ...a('localization')]),
    ...card('users', 'Users & Roles', UsersIcon, 'danger', [...a('users'), ...a('roles'), { id: 'setup/preferences', label: 'User preferences', keywords: 'appearance theme dark light density compact' }]),
    ...card('config', 'Setup & Configurations', CogIcon, 'warn', [...a('periods'), ...a('defaults'), ...a('numbering'), ...a('voucher-types'), ...m('currencies'), ...m('exchange-rates'), ...m('payment-terms'), ...(visibleModules.includes('accounting') ? [{ id: 'accounting/opening-balances', label: 'Opening balances' }] : [])]),
    ...card('tax', 'Taxes & Compliance', PercentIcon, 'info', [...m('tax-rates'), ...m('tds'), ...m('hsn')]),
    ...card('custom', 'Customization', EditIcon, 'violet', [...a('templates'), ...a('notifications'), ...m('dimensions'), ...m('reason-codes')]),
    ...card('automation', 'Automation', ZapIcon, 'good', [...a('workflows'), ...a('jobs')]),
  ];

  const moduleCards: [string, string, SetupCard['icon'], SetupLink[]][] = [
    ['sales', 'Sales', ReceiptIcon, [...ms('sales'), ...m('customers'), ...m('price-lists'), ...m('salespersons')]],
    ['purchase', 'Purchase', ShoppingCartIcon, [...ms('purchase'), ...m('suppliers')]],
    ['items', 'Items & Inventory', PackageIcon, [...ms('inventory'), ...m('items'), ...m('warehouses'), ...m('uoms')]],
    ['accounting', 'Accounting', BookOpenIcon, [...ms('accounting'), ...m('accounts')]],
    ['banking', 'Banking', BuildingIcon, ms('banking')],
    ['taxation', 'Taxation', PercentIcon, ms('taxation')],
    ['payroll', 'Payroll', CreditCardIcon, [...ms('payroll'), ...m('employees')]],
    ['projects', 'Projects', FileTextIcon, ms('projects')],
    ['production', 'Production', FactoryIcon, ms('production')],
    ['pos', 'POS', MonitorIcon, ms('pos')],
    ['budgets', 'Budgets & Expenses', WalletIcon, ms('budgets')],
  ];
  const modules: SetupCard[] = moduleCards.flatMap(([id, title, icon, links], i) => card(id, title, icon, MODULE_TONES[i % MODULE_TONES.length], links));

  const developer: SetupCard[] = [
    ...card('integrations', 'Integrations & Marketplace', LinkIcon, 'good', a('integrations')),
    ...card('data', 'Developer Data', DatabaseIcon, 'warn', [...a('audit'), ...a('data'), ...m('imports'), ...m('reference')]),
    ...(s.isPlatformAdmin ? card('platform', 'Platform Administration', ShieldCheckIcon, 'danger', PLATFORM_NAV.map((i) => ({ id: `platform/${i.id}`, label: i.label }))) : []),
  ];

  return ([
    { id: 'organization', title: 'Organization Settings', cards: organization },
    { id: 'modules', title: 'Module Settings', cards: modules },
    { id: 'developer', title: 'Extension and Developer Data', cards: developer },
  ] as SetupSection[]).filter((sec) => sec.cards.length);
}

export const setupLinks = (sections: SetupSection[]): SetupLink[] => sections.flatMap((sec) => sec.cards.flatMap((c) => c.links));

export function useSetupSections(): SetupSection[] {
  const s = useSession();
  return useMemo(() => setupSections(s, visibleModuleIds(s)), [s]);
}

/** Modules that render inside the Setup navigation rather than the app sidebar. */
export const SETUP_MODULES = new Set(['setup', 'admin', 'masters', 'platform']);
/** Pages in ordinary modules that the hub links to (module settings, opening balances) — they stay
 *  inside the Setup navigation too, otherwise opening one from All Settings bounces the sidebar back
 *  to the app tree. */
const SETUP_PATHS = [...MODULE_SETTINGS.map((p) => p.id), 'accounting/opening-balances'];
export function isSetupPath(path: string): boolean {
  const p = path.replace(/^#?\/?/, '').split('?')[0];
  if (SETUP_MODULES.has(p.split('/')[0])) return true;
  return SETUP_PATHS.some((x) => p === x || p.startsWith(`${x}/`));
}

const RETURN_KEY = 'eb-setup-return';

/** Remember the last app page so "Close Settings" lands back on it. Setup pages are never stored —
 *  a refresh inside Setup would otherwise make the hub its own return target and Close a no-op. */
export function rememberSetupReturn(path: string) {
  if (isSetupPath(path)) return;
  try { sessionStorage.setItem(RETURN_KEY, path); } catch { /* ignore */ }
}
export function closeSetup() {
  let to: string | null = null;
  try { to = sessionStorage.getItem(RETURN_KEY); } catch { /* ignore */ }
  nav.go(to && !isSetupPath(to) ? to : 'home');
}
