// Per-line extras shared by every document grid: the batch / lot / serial breakup editor
// (one line issued from or received into many lots) and the per-line dimension picker
// (department / cost centre / project overriding the document header).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, C, engine } from '../../store';
import type { DocLine, Item, LineBreakup } from '../../store';
import { fmtDate, fmtQty, round, uid } from '../../lib/format';
import { Button, Badge } from './primitives';
import { EntityPicker, NumberField, useDimensionOptions } from './fields';
import { Modal } from './overlays';
import { PlusIcon, XIcon } from '../Icons';

// ── Batch / lot / serial breakup ───────────────────────────────────────────

const parseSerials = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** One-line summary of what a line moves: "B-101 ×50 · B-102 ×50", "12 serials", or "—". */
export function stockRowsSummary(l: Pick<DocLine, 'batch' | 'serials' | 'breakup'>, item?: Pick<Item, 'tracking'>): string {
  if (!item || item.tracking === 'None') return '—';
  const rows = engine.lineStockRows(l, 0).filter((r) => r.qty > 0 || r.batch || r.serials?.length);
  if (!rows.length || (rows.length === 1 && rows[0].id === 'single' && !rows[0].batch && !rows[0].serials?.length)) return '';
  if (rows.length === 1 && rows[0].id === 'single') return item.tracking === 'Serial' ? `${rows[0].serials?.length ?? 0} serial${(rows[0].serials?.length ?? 0) === 1 ? '' : 's'}` : rows[0].batch ?? '';
  return rows.map((r) => `${r.batch ?? (r.serials?.length ? `${r.serials.length} sn` : '?')}${r.qty ? ` ×${fmtQty(r.qty)}` : ''}`).join(' · ');
}

export interface LineBreakupEditorProps {
  open: boolean;
  onClose: () => void;
  line: DocLine;
  item: Item;
  /** quantity the line moves (accepted qty on a GRN, line qty elsewhere) */
  qty: number;
  direction: 'in' | 'out';
  warehouseId?: string;
  onSave: (patch: Pick<DocLine, 'batch' | 'serials' | 'breakup'>) => void;
}

/** Modal editor: split a line across batches / lots (with mfg + expiry) or list serials per lot; FEFO suggestions on issue. */
export function LineBreakupEditor({ open, onClose, line, item, qty, direction, warehouseId, onSave }: LineBreakupEditorProps) {
  const serial = item.tracking === 'Serial';
  const seed = (): LineBreakup[] => {
    const rows = engine.lineStockRows(line, qty);
    if (rows.length === 1 && rows[0].id === 'single') return [{ ...rows[0], id: uid('bk'), qty: rows[0].qty || qty }];
    return rows.map((r) => ({ ...r }));
  };
  const [rows, setRows] = useState<LineBreakup[]>(seed);
  // serial text is kept verbatim while typing and parsed on blur so separators don't jump the cursor
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setRows(seed()); setTexts({}); } }, [open, line.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const onHand = useMemo(() => (direction === 'out' && item.id ? engine.batchesOnHand(item.id, warehouseId) : []), [direction, item.id, warehouseId, open]);
  const sum = round(rows.reduce((s, r) => s + (serial ? (r.serials?.length ?? 0) : r.qty || 0), 0), 3);
  const errs = engine.validateLineStock({ breakup: rows.map((r) => ({ ...r, qty: serial ? (r.serials?.length ?? 0) : r.qty })) }, item, qty, { direction, warehouseId, itemId: item.id, allowNegative: engine.ctx().company?.defaults.allowNegativeStock });
  const update = (id: string, p: Partial<LineBreakup>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));
  const add = (p: Partial<LineBreakup> = {}) => setRows((rs) => [...rs, { id: uid('bk'), qty: Math.max(0, round(qty - sum, 3)), ...p }]);
  const fefo = () => {
    // fill from the earliest-expiring lots first until the line quantity is covered
    let left = qty;
    const out: LineBreakup[] = [];
    for (const b of onHand) {
      if (left <= 0.0005) break;
      const take = serial ? Math.min(left, b.serials.length) : Math.min(left, b.onHand);
      if (take <= 0) continue;
      out.push({ id: uid('bk'), batch: b.batch || undefined, qty: round(take, 3), expiryDate: b.expiryDate, mfgDate: b.mfgDate, serials: serial ? b.serials.slice(0, Math.round(take)) : undefined });
      left = round(left - take, 3);
    }
    if (out.length) setRows(out);
  };
  const save = () => {
    const clean = rows.map((r) => ({ ...r, qty: serial ? (r.serials?.length ?? 0) : r.qty })).filter((r) => r.qty > 0 || r.batch || r.serials?.length);
    if (clean.length <= 1) {
      const r = clean[0];
      onSave({ batch: r?.batch || undefined, serials: r?.serials?.length ? r.serials : undefined, breakup: undefined });
    } else onSave({ batch: undefined, serials: undefined, breakup: clean });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} width={720} title={<>{serial ? 'Serial numbers' : 'Batches / lots'} · {item.name}</>} description={`${direction === 'in' ? 'Receive' : 'Issue'} ${fmtQty(qty, item.baseUom)} ${direction === 'in' ? 'into' : 'from'} one or more ${serial ? 'lots, listing every serial' : 'batches / lots'}. Rows must add up to the line quantity.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={errs.length > 0} reason={errs[0]}>Apply split</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {direction === 'out' && onHand.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-3)' }}>
            <span>On hand:</span>
            {onHand.slice(0, 8).map((b) => <button key={b.batch || '(none)'} type="button" className="dim-chip" style={{ cursor: 'pointer', border: 'none' }} title={b.expiryDate ? `Expires ${fmtDate(b.expiryDate)}` : undefined} onClick={() => add({ batch: b.batch || undefined, expiryDate: b.expiryDate, qty: Math.min(Math.max(0, round(qty - sum, 3)), b.onHand), serials: serial ? b.serials.slice(0, Math.round(Math.max(0, qty - sum))) : undefined })}>{b.batch || 'unbatched'} · {fmtQty(b.onHand)}{b.expiryDate ? ` · exp ${fmtDate(b.expiryDate)}` : ''}</button>)}
            <Button size="sm" variant="link" onClick={fefo}>Auto-fill FEFO</Button>
          </div>
        )}
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data-table dense">
            <thead><tr><th style={{ minWidth: 140 }}>{serial ? 'Lot (optional)' : 'Batch / lot no.'}</th>{serial ? <th style={{ minWidth: 260 }}>Serial numbers</th> : null}<th className="right" style={{ width: 110 }}>Qty</th>{direction === 'in' && <th style={{ width: 140 }}>Mfg date</th>}{direction === 'in' && <th style={{ width: 140 }}>Expiry</th>}<th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input className="field-input grid" placeholder={serial ? 'Lot' : 'Batch no.'} value={r.batch ?? ''} onChange={(e) => update(r.id, { batch: e.target.value || undefined })} list={direction === 'out' ? `bk-${item.id}` : undefined} /></td>
                  {serial ? <td><textarea className="field-input" rows={2} style={{ fontSize: 12, height: 'auto', padding: '4px 8px' }} placeholder="SN-001, SN-002 … (comma, space or newline separated)" value={texts[r.id] ?? (r.serials ?? []).join(', ')} onChange={(e) => { const t = e.target.value; setTexts((x) => ({ ...x, [r.id]: t })); const s = parseSerials(t); update(r.id, { serials: s, qty: s.length }); }} onBlur={() => setTexts((x) => { const n = { ...x }; delete n[r.id]; return n; })} /></td> : null}
                  <td className="right">{serial ? <span className="money">{r.serials?.length ?? 0}</span> : <NumberField size="grid" value={r.qty} onChange={(v) => update(r.id, { qty: v })} decimals={3} min={0} />}</td>
                  {direction === 'in' && <td><input type="date" className="field-input grid" value={r.mfgDate ?? ''} onChange={(e) => update(r.id, { mfgDate: e.target.value || undefined })} /></td>}
                  {direction === 'in' && <td><input type="date" className="field-input grid" value={r.expiryDate ?? ''} onChange={(e) => update(r.id, { expiryDate: e.target.value || undefined })} /></td>}
                  <td><button type="button" className="btn-icon" onClick={() => remove(r.id)} title="Remove" style={{ width: 28, height: 28 }}><XIcon size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {direction === 'out' && <datalist id={`bk-${item.id}`}>{onHand.map((b) => <option key={b.batch} value={b.batch} />)}</datalist>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 12 }}>
            <button type="button" className="btn-link" onClick={() => add()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PlusIcon size={12} /> Add {serial ? 'lot' : 'batch'}</button>
            <span style={{ color: Math.abs(sum - qty) > 0.0005 ? 'var(--danger)' : 'var(--good)' }}>Split {fmtQty(sum)} of {fmtQty(qty, item.baseUom)}</span>
          </div>
        </div>
        {errs.length > 0 && <div className="field-error">{errs[0]}</div>}
      </div>
    </Modal>
  );
}

/** Grid cell: summary chip that opens the breakup editor (editable) or prints the summary (read-only). */
export function BatchCell({ line, item, qty, direction, warehouseId, readOnly, onChange }: { line: DocLine; item?: Item; qty: number; direction: 'in' | 'out'; warehouseId?: string; readOnly?: boolean; onChange?: (patch: Pick<DocLine, 'batch' | 'serials' | 'breakup'>) => void }) {
  const [open, setOpen] = useState(false);
  if (!item || item.tracking === 'None') return <span style={{ fontSize: 12, color: 'var(--ink-5)' }}>n/a</span>;
  const summary = stockRowsSummary(line, item);
  const rows = line.breakup?.length ?? 0;
  if (readOnly) return <span style={{ fontSize: 12 }} title={summary}>{summary || '—'}{rows > 1 ? <Badge status="Draft">{rows} lots</Badge> : null}</span>;
  return (
    <>
      <button type="button" className="field-input grid" style={{ textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: summary ? 'var(--ink)' : 'var(--ink-4)' }} onClick={() => setOpen(true)} title={summary || undefined}>
        {summary || (item.tracking === 'Serial' ? `${Math.round(qty)} serials…` : 'Batch / lot…')}
      </button>
      {open && <LineBreakupEditor open={open} onClose={() => setOpen(false)} line={line} item={item} qty={qty} direction={direction} warehouseId={warehouseId} onSave={(p) => onChange?.(p)} />}
    </>
  );
}

// ── Per-line dimensions ────────────────────────────────────────────────────

const DIM_KEYS: { key: string; label: string }[] = [{ key: 'Department', label: 'Department' }, { key: 'CostCentre', label: 'Cost centre' }, { key: 'Project', label: 'Project' }];

/** Effective dimensions of a line: its own values over the document header's. */
export function effectiveDimensions(line?: Record<string, string>, header?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  DIM_KEYS.forEach(({ key }) => { const v = line?.[key] ?? header?.[key]; if (v) out[key] = v; });
  return out;
}

export function DimensionChips({ value, header }: { value?: Record<string, string>; header?: Record<string, string> }): ReactNode {
  const eff = effectiveDimensions(value, header);
  const keys = Object.keys(eff);
  if (!keys.length) return <span style={{ fontSize: 12, color: 'var(--ink-5)' }}>—</span>;
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{keys.map((k) => <span key={k} className="dim-chip" style={{ opacity: value?.[k] ? 1 : 0.65 }} title={`${k}${value?.[k] ? '' : ' (from header)'}`}>{db.find<any>(C.dimensions, eff[k])?.code ?? eff[k]}</span>)}</span>;
}

/** Popover picker for a line's Department / Cost centre / Project; header values show as the inherited default. */
export function LineDimensionsCell({ value, header, readOnly, onChange }: { value?: Record<string, string>; header?: Record<string, string>; readOnly?: boolean; onChange?: (v: Record<string, string> | undefined) => void }) {
  const dept = useDimensionOptions('Department');
  const cc = useDimensionOptions('CostCentre');
  const prj = useDimensionOptions('Project');
  const opts: Record<string, typeof dept> = { Department: dept, CostCentre: cc, Project: prj };
  const [open, setOpen] = useState(false);
  if (readOnly) return <DimensionChips value={value} header={header} />;
  const set = (k: string, id?: string) => {
    const n = { ...(value ?? {}) };
    if (id) n[k] = id; else delete n[k];
    onChange?.(Object.keys(n).length ? n : undefined);
  };
  const overridden = DIM_KEYS.some(({ key }) => value?.[key] && value[key] !== header?.[key]);
  // a modal rather than a popover: the grid scrolls sideways, and a scroll container clips anchored panels
  return (
    <>
      <button type="button" className="field-input grid" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', textAlign: 'left' }} onClick={() => setOpen(true)} title={overridden ? 'Line overrides the header' : 'Inherits the document header — click to override'}><DimensionChips value={value} header={header} /></button>
      <Modal open={open} onClose={() => setOpen(false)} width={440} title="Line dimensions" description="Blank fields inherit the document header; the journal follows the line." footer={<><Button variant="ghost" onClick={() => onChange?.(undefined)} disabled={!value || !Object.keys(value).length}>Clear overrides</Button><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {DIM_KEYS.map(({ key, label }) => (
            <EntityPicker key={key} label={label} value={value?.[key]} onChange={(id) => set(key, id)} options={opts[key]} placeholder={header?.[key] ? `Header: ${db.find<any>(C.dimensions, header[key])?.name ?? header[key]}` : 'Not set on the header'} />
          ))}
        </div>
      </Modal>
    </>
  );
}
