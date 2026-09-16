// In-memory, localStorage-persisted document store.
// Every module reads via useCollection()/useRecord() and writes via db.insert/update/remove.
// Collections are plain string keys; module code should use the constants in ./collections.ts.

import { useSyncExternalStore } from 'react';
import type { BaseRecord, ID } from './types';
import { uid } from '../lib/format';

export type Row = BaseRecord & Record<string, any>;
export type DB = Record<string, Row[]>;

const STORAGE_KEY = 'elixir-books-db';
export const SEED_VERSION = 'v7';

let state: DB = {};
let seedFn: (() => DB) | null = null;
let actorGetter: () => { id?: string; name: string; companyId?: string } = () => ({ name: 'system' });
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let suppress = 0;

/**
 * Plan catalogue migration only. Business documents, users, companies and all
 * other tenant data remain untouched. Legacy Pro tenants go to ERP Enterprise
 * so manufacturing access is never removed during the three-plan migration.
 */
function migrateV1ToV2(raw: DB): DB {
  const growthModules = ['home', 'approvals', 'crm', 'sales', 'purchase', 'inventory', 'pos', 'projects', 'accounting', 'banking', 'taxation', 'payroll', 'fixed-assets', 'budgets', 'reports', 'masters', 'admin'];
  const plans = (raw.plans ?? []).map((plan) => {
    if (plan.id === 'plan_lite') return { ...plan, priceMonthly: 899 };
    if (plan.id === 'plan_std') return { ...plan, code: 'GROWTH', name: 'Growth', tier: 'Growth', planVersion: 1, modules: growthModules, priceMonthly: 2099 };
    if (plan.id === 'plan_pro') return { ...plan, code: 'PRO-LEGACY', name: 'Pro (legacy)', tier: 'Pro', status: 'Retired' };
    if (plan.id === 'plan_ent') return { ...plan, code: 'ERP', name: 'ERP Enterprise', tier: 'Enterprise', priceMonthly: 6999 };
    return plan;
  });
  const tenants = (raw.tenants ?? []).map((tenant) => tenant.planId === 'plan_pro' ? { ...tenant, planId: 'plan_ent' } : tenant);
  return { ...raw, plans, tenants };
}

/**
 * v4: document template layouts. Additive only — appends seeded templates that are
 * missing (by id) so the new invoice layouts appear without touching tenant data.
 */
function migrateV3ToV4(raw: DB): DB {
  const fresh = seedFn ? seedFn() : {};
  const have = new Set((raw.templates ?? []).map((r) => r.id));
  const added = (fresh.templates ?? []).filter((t) => !have.has(t.id));
  return { ...raw, templates: [...(raw.templates ?? []), ...added] };
}

/**
 * v5: GRNI (2110) stops being an AP-control account. Its lines never carry a supplier (the bill has
 * not arrived yet), so as a control it forced parties onto manual true-ups and inflated the AP
 * control total against the supplier sub-ledger. Data-only: flags on one account record.
 */
function migrateV4ToV5(raw: DB): DB {
  const accounts = (raw.accounts ?? []).map((a) => (a.code === '2110' && a.controlType === 'AP' ? { ...a, isControl: false, controlType: undefined } : a));
  return { ...raw, accounts };
}

/**
 * v7: sales-invoice enhancements (invoice type / RCM / voucher types / invoice discount). Additive only:
 * appends the seeded 5540 Discount Allowed account, the voucher types and their series, and copies the
 * demo LUT onto the seeded company when it has none. Tenant documents are untouched — every new field
 * is optional and older documents keep computing exactly as before.
 */
function migrateV6ToV7(raw: DB): DB {
  const fresh = seedFn ? seedFn() : {};
  const appendMissing = (col: string) => {
    const have = new Set((raw[col] ?? []).map((r) => r.id));
    return [...(raw[col] ?? []), ...(fresh[col] ?? []).filter((r) => !have.has(r.id))];
  };
  const companies = (raw.companies ?? []).map((c) => {
    const seeded = (fresh.companies ?? []).find((f) => f.id === c.id);
    const lut = seeded?.defaults?.tax?.lutNumber;
    return lut && !c.defaults?.tax?.lutNumber ? { ...c, defaults: { ...c.defaults, tax: { ...(c.defaults?.tax ?? {}), lutNumber: lut, lutValidFrom: seeded.defaults.tax.lutValidFrom, lutValidTo: seeded.defaults.tax.lutValidTo } } } : c;
  });
  return { ...raw, accounts: appendMissing('accounts'), voucherTypes: appendMissing('voucherTypes'), numberSeries: appendMissing('numberSeries'), companies };
}

function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SEED_VERSION, state }));
    } catch {
      /* storage may be unavailable */
    }
  }, 150);
}

function emit() {
  if (suppress > 0) return;
  listeners.forEach((l) => l());
  persist();
}

function nowIso() {
  return new Date().toISOString();
}

export class ConflictError extends Error {
  code = 'CONFLICT';
  constructor(msg = 'Someone else changed this record — reload to see their changes') {
    super(msg);
  }
}

export class ValidationError extends Error {
  code: string;
  field?: string;
  constructor(message: string, code = 'VALIDATION', field?: string) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

export const EMPTY: Row[] = [];

export const db = {
  /** Register the seed builder; called once from store/index. */
  registerSeed(fn: () => DB) {
    seedFn = fn;
  },

  /** Load persisted state or build seed. Idempotent. */
  init() {
    if (Object.keys(state).length) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.v === SEED_VERSION && parsed.state && typeof parsed.state === 'object') {
          state = parsed.state;
          return;
        }
        if ((parsed?.v === 'v5' || parsed?.v === 'v6') && parsed.state && typeof parsed.state === 'object') {
          state = migrateV6ToV7(parsed.state);
          persist();
          return;
        }
        if (parsed?.v === 'v4' && parsed.state && typeof parsed.state === 'object') {
          state = migrateV6ToV7(migrateV4ToV5(parsed.state));
          persist();
          return;
        }
        if (parsed?.v === 'v3' && parsed.state && typeof parsed.state === 'object') {
          state = migrateV6ToV7(migrateV4ToV5(migrateV3ToV4(parsed.state)));
          persist();
          return;
        }
        if ((parsed?.v === 'v1' || parsed?.v === 'v2') && parsed.state && typeof parsed.state === 'object') {
          state = migrateV6ToV7(migrateV4ToV5(migrateV3ToV4(migrateV1ToV2(parsed.state))));
          persist();
          return;
        }
      }
    } catch {
      /* fallthrough to seed */
    }
    state = seedFn ? seedFn() : {};
    persist();
  },

  /** Clear persisted data and reseed. */
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    state = seedFn ? seedFn() : {};
    emit();
  },

  setActorGetter(fn: typeof actorGetter) {
    actorGetter = fn;
  },

  actor() {
    return actorGetter();
  },

  snapshot(): DB {
    return state;
  },

  collections(): string[] {
    return Object.keys(state);
  },

  get<T extends BaseRecord = Row>(col: string): T[] {
    return (state[col] ?? EMPTY) as unknown as T[];
  },

  find<T extends BaseRecord = Row>(col: string, id: ID | undefined | null): T | undefined {
    if (!id) return undefined;
    return (state[col] ?? EMPTY).find((r) => r.id === id) as T | undefined;
  },

  findBy<T extends BaseRecord = Row>(col: string, pred: (r: T) => boolean): T | undefined {
    return (state[col] ?? EMPTY).find((r) => pred(r as unknown as T)) as T | undefined;
  },

  where<T extends BaseRecord = Row>(col: string, pred: (r: T) => boolean): T[] {
    return (state[col] ?? EMPTY).filter((r) => pred(r as unknown as T)) as unknown as T[];
  },

  count(col: string, pred?: (r: Row) => boolean): number {
    const rows = state[col] ?? EMPTY;
    return pred ? rows.filter(pred).length : rows.length;
  },

  insert<T extends BaseRecord = Row>(col: string, rec: Omit<Partial<T>, 'id'> & { id?: ID } & Record<string, any>): T {
    const now = nowIso();
    const actor = actorGetter();
    const row = {
      companyId: actor.companyId,
      ...rec,
      id: rec.id ?? uid(col.slice(0, 3)),
      createdAt: rec.createdAt ?? now,
      updatedAt: now,
      createdBy: rec.createdBy ?? actor.name,
      updatedBy: actor.name,
      version: 1,
    } as unknown as T;
    state = { ...state, [col]: [...(state[col] ?? EMPTY), row as unknown as Row] };
    emit();
    return row;
  },

  insertMany<T extends BaseRecord = Row>(col: string, recs: (Omit<Partial<T>, 'id'> & { id?: ID } & Record<string, any>)[]): T[] {
    const now = nowIso();
    const actor = actorGetter();
    const rows = recs.map(
      (rec) =>
        ({
          companyId: actor.companyId,
          ...rec,
          id: rec.id ?? uid(col.slice(0, 3)),
          createdAt: rec.createdAt ?? now,
          updatedAt: now,
          createdBy: rec.createdBy ?? actor.name,
          updatedBy: actor.name,
          version: 1,
        }) as unknown as T,
    );
    state = { ...state, [col]: [...(state[col] ?? EMPTY), ...(rows as unknown as Row[])] };
    emit();
    return rows;
  },

  /**
   * Patch a record. Pass `expectedVersion` for optimistic concurrency —
   * a stale version throws ConflictError and writes nothing.
   */
  update<T extends BaseRecord = Row>(
    col: string,
    id: ID,
    patch: Partial<T> | ((prev: T) => Partial<T>),
    opts: { expectedVersion?: number } = {},
  ): T {
    const rows = state[col] ?? EMPTY;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new ValidationError(`Record ${id} not found in ${col}`, 'NOT_FOUND');
    const prev = rows[idx] as unknown as T;
    if (opts.expectedVersion !== undefined && prev.version !== opts.expectedVersion) throw new ConflictError();
    const p = typeof patch === 'function' ? patch(prev) : patch;
    const next = { ...prev, ...p, updatedAt: nowIso(), updatedBy: actorGetter().name, version: prev.version + 1 } as T;
    const copy = rows.slice();
    copy[idx] = next as unknown as Row;
    state = { ...state, [col]: copy };
    emit();
    return next;
  },

  /** Update without bumping the version or touching timestamps (for derived counters). */
  patchSilent<T extends BaseRecord = Row>(col: string, id: ID, patch: Partial<T>): T | undefined {
    const rows = state[col] ?? EMPTY;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return undefined;
    const next = { ...rows[idx], ...patch } as unknown as T;
    const copy = rows.slice();
    copy[idx] = next as unknown as Row;
    state = { ...state, [col]: copy };
    emit();
    return next;
  },

  remove(col: string, id: ID) {
    const rows = state[col] ?? EMPTY;
    if (!rows.some((r) => r.id === id)) return;
    state = { ...state, [col]: rows.filter((r) => r.id !== id) };
    emit();
  },

  setCollection<T extends BaseRecord = Row>(col: string, rows: T[]) {
    state = { ...state, [col]: rows as unknown as Row[] };
    emit();
  },

  /**
   * Batch several writes and notify listeners once. Every write replaces `state` with a new
   * object, so the pre-transaction reference is a complete snapshot: if `fn` throws, state is
   * restored to it and nothing that happened inside (numbers allocated, stock moved, journals
   * inserted) survives. Nested transactions roll back only their own writes.
   */
  transaction<R>(fn: () => R): R {
    let result: R;
    const before = state;
    suppress++;
    try {
      result = fn();
    } catch (e) {
      state = before;
      throw e;
    } finally {
      suppress--;
    }
    if (suppress === 0) emit();
    return result;
  },

  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};


/** Reactive read of an entire collection (stable reference until it changes). */
export function useCollection<T extends BaseRecord = Row>(col: string): T[] {
  return useSyncExternalStore(db.subscribe, () => db.get<T>(col), () => db.get<T>(col));
}

/** Reactive read of a single record. */
export function useRecord<T extends BaseRecord = Row>(col: string, id: ID | undefined | null): T | undefined {
  return useSyncExternalStore(
    db.subscribe,
    () => db.find<T>(col, id),
    () => db.find<T>(col, id),
  );
}

/** Reactive read of the whole DB snapshot (re-renders on any change). Use sparingly. */
export function useDb(): DB {
  return useSyncExternalStore(db.subscribe, () => db.snapshot(), () => db.snapshot());
}
