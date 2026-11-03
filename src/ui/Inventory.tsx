import { create } from 'zustand';
import { useEffect, useMemo, useState } from 'react';
import { world, type Slot, addItem } from '../sim/world';
import { accepts } from '../sim/engine';
import { useStore, useTick } from '../store';
import { ItemIcon, Ic } from './icons';
import { itemName, ITEM_KEYS, ITEMS, stackSize, GROUP_LABEL } from '../data/items';

type Hand = { node: string; idx: number; half: boolean } | null;
export const useHand = create<{ hand: Hand; set: (h: Hand) => void }>((set) => ({ hand: null, set: (hand) => set({ hand }) }));

function canPlace(nodeId: string, s: string) {
  const n = world.current.nodes[nodeId];
  return !!n && (n.def === 'player' || accepts(n, s));
}

export function moveSlot(fromNode: string, fromIdx: number, toNode: string, toIdx: number, qty?: number) {
  const a = world.current.nodes[fromNode], b = world.current.nodes[toNode];
  if (!a || !b) return;
  const src = a.inv[fromIdx];
  if (!src) return;
  if (!canPlace(toNode, src.s)) return;
  const amount = Math.min(qty ?? src.n, src.n);
  const dst = b.inv[toIdx];
  const max = stackSize(src.s);
  if (!dst) {
    b.inv[toIdx] = { ...src, n: amount };
    src.n -= amount;
  } else if (dst.s === src.s && dst.g === src.g) {
    const k = Math.min(max - dst.n, amount);
    dst.n += k;
    src.n -= k;
  } else if (amount === src.n && canPlace(fromNode, dst.s)) {
    a.inv[fromIdx] = dst;
    b.inv[toIdx] = src;
    return;
  }
  if (src.n <= 0) a.inv[fromIdx] = null;
}

export function InventoryGrid({ nodeId, from = 0, to, zone, other }: { nodeId: string; from?: number; to?: number; zone?: boolean; other?: string | null }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const { hand, set } = useHand();
  const n = world.current.nodes[nodeId];
  if (!n) return null;
  const end = to ?? n.inv.length;
  const idxs = Array.from({ length: end - from }, (_, i) => from + i);

  const click = (i: number, e: React.MouseEvent) => {
    const sl = n.inv[i];
    if (!hand) {
      if (!sl) return;
      if (e.shiftKey && other) {
        // quick move to the other open inventory
        const o = world.current.nodes[other];
        if (o && canPlace(other, sl.s)) {
          const moved = addItem(o.inv, sl.s, sl.n, sl.g);
          sl.n -= moved;
          if (sl.n <= 0) n.inv[i] = null;
          poke();
        }
        return;
      }
      set({ node: nodeId, idx: i, half: false });
      return;
    }
    if (hand.node === nodeId && hand.idx === i) { set(null); return; }
    const src = world.current.nodes[hand.node]?.inv[hand.idx];
    if (src) moveSlot(hand.node, hand.idx, nodeId, i, hand.half ? Math.ceil(src.n / 2) : undefined);
    set(null);
    poke();
  };
  const ctx = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (n.inv[i] && !hand) set({ node: nodeId, idx: i, half: true });
  };

  return (
    <div className="inv">
      {idxs.map((i) => {
        const sl = n.inv[i] as Slot;
        const picked = hand?.node === nodeId && hand.idx === i;
        return (
          <button
            key={i}
            className={`slot ${picked ? 'picked' : ''} ${zone ? 'zone' : ''}`}
            onClick={(e) => click(i, e)}
            onContextMenu={(e) => ctx(i, e)}
            title={sl ? `${itemName(sl.s)} ×${sl.n}${sl.g ? `, ${sl.g}` : ''}` : 'Empty slot'}
            aria-label={sl ? `${itemName(sl.s)}, ${sl.n}` : 'Empty slot'}
          >
            {sl && <ItemIcon s={sl.s} size={40} />}
            {sl && sl.n > 1 && <span className="n">{sl.n >= 10000 ? `${Math.floor(sl.n / 1000)}k` : sl.n}</span>}
            {sl?.g && <span className="gn">{sl.g}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function HandBar() {
  useTick();
  const { hand, set } = useHand();
  const poke = useStore((s) => s.poke);
  if (!hand) return <p className="help">Tap a slot to pick it up, then tap another slot to drop. Shift-click moves a stack across; right-click picks up half.</p>;
  const sl = world.current.nodes[hand.node]?.inv[hand.idx];
  if (!sl) return null;
  return (
    <div className="hand">
      <ItemIcon s={sl.s} size={28} />
      <span style={{ flex: 1 }}>Holding {hand.half ? 'half of ' : ''}{itemName(sl.s)} ×{sl.n}</span>
      <button className="btn" onClick={() => set(null)}>Cancel</button>
      <button
        className="btn danger"
        onClick={() => { world.current.nodes[hand.node].inv[hand.idx] = null; set(null); poke(); }}
      >
        <Ic.trash />Destroy
      </button>
    </div>
  );
}

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
    return ITEM_KEYS.filter((k) => (!filter || filter(k)) && (group === 'all' || ITEMS[k].g === group) && (!t || ITEMS[k].n.toLowerCase().includes(t) || k.includes(t))).slice(0, 400);
  }, [q, group, filter]);
  const groups = useMemo(() => [...new Set(ITEM_KEYS.filter((k) => !filter || filter(k)).map((k) => ITEMS[k].g))], [filter]);
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
          <input className="search" style={{ flex: '1 1 220px' }} autoFocus placeholder="Search all Rust items" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: 160 }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g] ?? g}</option>)}
          </select>
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
          {!list.length && <p className="muted">No items match “{q}”.</p>}
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
