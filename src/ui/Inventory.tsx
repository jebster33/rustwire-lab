import { create } from 'zustand';
import { useEffect, useMemo, useRef, useState } from 'react';
import { world, type Slot, addItem, countItem } from '../sim/world';
import { accepts } from '../sim/engine';
import { DEF } from '../sim/defs';
import { useStore, useTick } from '../store';
import { ItemIcon, Ic } from './icons';
import { itemName, ITEM_KEYS, ITEMS, stackSize, GROUP_LABEL } from '../data/items';

export const ME = '__me';
type Hand = { node: string; idx: number; half: boolean } | null;
export const useHand = create<{ hand: Hand; set: (h: Hand) => void }>((set) => ({ hand: null, set: (hand) => set({ hand }) }));

/** Inventory owner: a deployable, or "My inventory". */
export function invOf(id: string): Slot[] | null {
  if (id === ME) return world.current.me;
  return world.current.nodes[id]?.inv ?? null;
}
export function canPlace(id: string, s: string) {
  if (id === ME) return true;
  const n = world.current.nodes[id];
  return !!n && accepts(n, s);
}

export function moveSlot(fromId: string, fromIdx: number, toId: string, toIdx: number, qty?: number) {
  const a = invOf(fromId), b = invOf(toId);
  if (!a || !b) return;
  const src = a[fromIdx];
  if (!src || !canPlace(toId, src.s)) return;
  const amount = Math.min(qty ?? src.n, src.n);
  const dst = b[toIdx];
  const max = stackSize(src.s);
  if (!dst) {
    b[toIdx] = { ...src, n: amount };
    src.n -= amount;
  } else if (dst.s === src.s && dst.g === src.g) {
    if (a === b && fromIdx === toIdx) return;
    const k = Math.min(max - dst.n, amount);
    dst.n += k;
    src.n -= k;
  } else if (amount === src.n && canPlace(fromId, dst.s)) {
    a[fromIdx] = dst;
    b[toIdx] = src;
    return;
  }
  if (src.n <= 0) a[fromIdx] = null;
}

type Drag = { node: string; idx: number; x: number; y: number; started: boolean; half: boolean };

export function InventoryGrid({ nodeId, from = 0, to, zone, other }: { nodeId: string; from?: number; to?: number; zone?: boolean; other?: string | null }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const { hand, set } = useHand();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const inv = invOf(nodeId);
  if (!inv) return null;
  const end = to ?? inv.length;
  const idxs = Array.from({ length: end - from }, (_, i) => from + i);

  const slotAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-slot]') as HTMLElement | null;
    if (!el) return null;
    const [node, idx] = el.dataset.slot!.split('|');
    return { node, idx: Number(idx) };
  };

  const onDown = (i: number, e: React.PointerEvent) => {
    if (!inv[i] || e.button === 1) return;
    const d: Drag = { node: nodeId, idx: i, x: e.clientX, y: e.clientY, started: false, half: e.button === 2 };
    const move = (ev: PointerEvent) => {
      if (!d.started && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) d.started = true;
      if (d.started) {
        d.x = ev.clientX; d.y = ev.clientY;
        setDrag({ ...d });
        const t = slotAt(ev.clientX, ev.clientY);
        setOver(t ? `${t.node}|${t.idx}` : null);
      }
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (d.started) {
        suppressClick.current = true;
        const t = slotAt(ev.clientX, ev.clientY);
        const src = invOf(d.node)?.[d.idx];
        if (t && src) { moveSlot(d.node, d.idx, t.node, t.idx, d.half ? Math.ceil(src.n / 2) : undefined); poke(); }
        set(null);
      }
      setDrag(null);
      setOver(null);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const click = (i: number, e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const sl = inv[i];
    if (!hand) {
      if (!sl) return;
      if (e.shiftKey && other) {
        const o = invOf(other);
        if (o && canPlace(other, sl.s)) {
          const moved = addItem(o, sl.s, sl.n, sl.g);
          sl.n -= moved;
          if (sl.n <= 0) inv[i] = null;
          poke();
        }
        return;
      }
      set({ node: nodeId, idx: i, half: false });
      return;
    }
    if (hand.node === nodeId && hand.idx === i) { set(null); return; }
    const src = invOf(hand.node)?.[hand.idx];
    if (src) moveSlot(hand.node, hand.idx, nodeId, i, hand.half ? Math.ceil(src.n / 2) : undefined);
    set(null);
    poke();
  };
  const ctx = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (inv[i] && !hand && !drag) set({ node: nodeId, idx: i, half: true });
  };

  const dragged = drag?.started ? invOf(drag.node)?.[drag.idx] : null;
  return (
    <>
      <div className="inv">
        {idxs.map((i) => {
          const sl = inv[i] as Slot;
          const picked = hand?.node === nodeId && hand.idx === i;
          const key = `${nodeId}|${i}`;
          return (
            <button
              key={i}
              data-slot={key}
              className={`slot ${picked ? 'picked' : ''} ${zone ? 'zone' : ''} ${over === key ? 'drop-target' : ''}`}
              onPointerDown={(e) => onDown(i, e)}
              onClick={(e) => click(i, e)}
              onContextMenu={(e) => ctx(i, e)}
              style={{ touchAction: sl ? 'none' : undefined }}
              title={sl ? `${itemName(sl.s)} ×${sl.n}${sl.g ? ` (${sl.g})` : ''}` : 'Empty slot'}
              aria-label={sl ? `${itemName(sl.s)}, ${sl.n}` : 'Empty slot'}
            >
              {sl && <ItemIcon s={sl.s} size={40} />}
              {sl && sl.n > 1 && <span className="n">{sl.n >= 10000 ? `${Math.floor(sl.n / 1000)}k` : sl.n}</span>}
              {sl?.g && <span className="gn">{sl.g}</span>}
            </button>
          );
        })}
      </div>
      {dragged && drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <ItemIcon s={dragged.s} size={40} />
          <span>{drag.half ? Math.ceil(dragged.n / 2) : dragged.n}</span>
        </div>
      )}
    </>
  );
}

export function HandBar() {
  useTick();
  const { hand, set } = useHand();
  const poke = useStore((s) => s.poke);
  if (!hand) return <p className="help">Drag items between slots, or tap one then tap where it goes. Right-drag moves half; shift-click sends a stack across.</p>;
  const inv = invOf(hand.node);
  const sl = inv?.[hand.idx];
  if (!sl || !inv) return null;
  return (
    <div className="hand">
      <ItemIcon s={sl.s} size={28} />
      <span style={{ flex: 1 }}>Holding {hand.half ? 'half of ' : ''}{itemName(sl.s)} ×{sl.n}</span>
      <button className="btn" onClick={() => set(null)}>Cancel</button>
      <button className="btn danger" onClick={() => { inv[hand.idx] = null; set(null); poke(); }}><Ic.trash />Destroy</button>
    </div>
  );
}

/** Items a container can actually hold, for pickers. */
export const filterFor = (nodeId: string) => {
  if (nodeId === ME) return undefined;
  const n = world.current.nodes[nodeId];
  if (!n) return undefined;
  return (s: string) => accepts(n, s) && ITEMS[s]?.g !== 'sim';
};

/** Searchable picker for any Rust item. */
export function ItemPicker({
  title, onPick, onClose, filter, withAmount = true, initialAmount,
}: {
  title: string;
  onPick: (s: string, amount: number) => void;
  onClose: () => void;
  filter?: (s: string) => boolean;
  withAmount?: boolean;
  initialAmount?: number;
}) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(initialAmount ?? 0);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ITEM_KEYS.filter((k) => ITEMS[k].g !== 'sim' && (!filter || filter(k)) && (group === 'all' || ITEMS[k].g === group) && (!t || ITEMS[k].n.toLowerCase().includes(t) || k.includes(t))).slice(0, 1000);
  }, [q, group, filter]);
  const groups = useMemo(() => [...new Set(ITEM_KEYS.filter((k) => ITEMS[k].g !== 'sim' && (!filter || filter(k))).map((k) => ITEMS[k].g))], [filter]);
  const amt = amount || (sel ? stackSize(sel) : 1);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Ic.x /></button>
        </div>
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="search" style={{ flex: '1 1 220px' }} autoFocus placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
          {groups.length > 1 && (
            <select className="select" style={{ width: 160 }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] ?? g}</option>)}
            </select>
          )}
        </div>
        <div className="dialog-body">
          <div className="picker-grid">
            {list.map((k) => (
              <button
                key={k}
                className="pick"
                aria-pressed={sel === k}
                onClick={() => (withAmount ? setSel(k) : onPick(k, 1))}
                onDoubleClick={() => onPick(k, amount || stackSize(k))}
                title={ITEMS[k].d}
              >
                <ItemIcon s={k} size={40} />
                <span>{ITEMS[k].n}</span>
              </button>
            ))}
          </div>
          {!list.length && <p className="muted">{q ? `No items match “${q}”.` : 'Nothing fits in here.'}</p>}
        </div>
        {withAmount && (
          <div className="dialog-foot" style={{ alignItems: 'center' }}>
            {sel && <ItemIcon s={sel} size={30} />}
            <span style={{ flex: 1 }} className="muted">{sel ? itemName(sel) : 'Pick an item'}</span>
            <label className="muted small" htmlFor="pick-amt">Amount</label>
            <input id="pick-amt" className="input" style={{ width: 110 }} type="number" min={1} value={amt} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
            <button className="btn primary" disabled={!sel} onClick={() => sel && onPick(sel, amt)}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

const TIER_LABEL = ['No workbench', 'Workbench 1', 'Workbench 2', 'Workbench 3'];

/** Large blueprint browser: every craftable item, filterable, coloured by workbench tier. */
export function BlueprintPicker({
  title = 'Add blueprint', maxTier = 3, onPick, onClose, withAmount = true, have,
}: {
  title?: string;
  maxTier?: number;
  onPick: (s: string, amount: number) => void;
  onClose: () => void;
  withAmount?: boolean;
  /** inventory used to show what can be crafted right now */
  have?: Slot[];
}) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [tier, setTier] = useState<number | 'all'>('all');
  const [canOnly, setCanOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [amount, setAmount] = useState(1);
  const all = useMemo(() => ITEM_KEYS.filter((k) => ITEMS[k].c && ITEMS[k].g !== 'sim' && ITEMS[k].c!.wb <= maxTier), [maxTier]);
  const canCraft = (k: string) => !!have && ITEMS[k].c!.i.every(([s, a]) => countItem(have, s) >= a);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((k) =>
      (group === 'all' || ITEMS[k].g === group) &&
      (tier === 'all' || ITEMS[k].c!.wb === tier) &&
      (!canOnly || canCraft(k)) &&
      (!t || ITEMS[k].n.toLowerCase().includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, group, tier, canOnly, all]);
  const groups = useMemo(() => [...new Set(all.map((k) => ITEMS[k].g))].sort(), [all]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);
  const rec = sel ? ITEMS[sel].c! : null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog wide bp-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Ic.x /></button>
        </div>
        <div className="bp-filters">
          <input className="search" autoFocus placeholder="Search blueprints" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] ?? g}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Workbench level">
            <button aria-pressed={tier === 'all'} onClick={() => setTier('all')}>All</button>
            {[0, 1, 2, 3].filter((t) => t <= maxTier).map((t) => (
              <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)} className={`tier-${t} tier-btn`}>{t === 0 ? 'None' : `WB${t}`}</button>
            ))}
          </div>
          {have && <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={canOnly} onChange={(e) => setCanOnly(e.target.checked)} />Can craft now</label>}
        </div>
        <div className="dialog-body">
          <div className="bp-grid">
            {list.map((k) => {
              const r = ITEMS[k].c!;
              return (
                <button
                  key={k}
                  className={`bp-card tier-${r.wb} ${have && !canCraft(k) ? 'cant' : ''}`}
                  aria-pressed={sel === k}
                  onClick={() => (withAmount ? setSel(k) : onPick(k, 1))}
                  onDoubleClick={() => onPick(k, amount)}
                  title={`${ITEMS[k].n}: ${TIER_LABEL[r.wb]}`}
                >
                  <ItemIcon s={k} size={44} />
                  <span>{ITEMS[k].n}</span>
                </button>
              );
            })}
          </div>
          {!list.length && <p className="muted">No blueprints match these filters.</p>}
        </div>
        {withAmount && (
          <div className="dialog-foot bp-foot">
            {sel && rec ? (
              <>
                <ItemIcon s={sel} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{itemName(sel)} <span className={`tier-chip tier-${rec.wb}`}>{TIER_LABEL[rec.wb]}</span></div>
                  <small className="muted">{rec.i.map(([s, a]) => `${a * Math.ceil(amount / rec.y)} ${itemName(s)}`).join(', ')}</small>
                </div>
                <label className="muted small" htmlFor="bp-amt">Amount</label>
                <input id="bp-amt" className="input" style={{ width: 90 }} type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
                <button className="btn primary" onClick={() => onPick(sel, amount)}>Add</button>
              </>
            ) : <span className="muted">Pick a blueprint. Card colours show the workbench level it needs.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export const defName = (id: string) => (id === ME ? 'My inventory' : DEF[world.current.nodes[id]?.def]?.name ?? '');
