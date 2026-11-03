import { memo, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useStore, type DepNode, type NoteData } from '../store';

function NoteNodeView({ id, data, selected }: NodeProps<DepNode>) {
  const d = data as unknown as NoteData;
  const setNote = useStore((s) => s.setNote);
  const [edit, setEdit] = useState(false);
  if (d.kind === 'box') {
    return (
      <>
        <NodeResizer isVisible={selected} minWidth={96} minHeight={72} lineClassName="note-resize-line" handleClassName="note-resize-handle" />
        <div className="note-box" style={{ borderColor: d.color, color: d.color }}>
          <span className="note-hit" />
          {edit ? (
            <input
              className="note-box-title nodrag"
              autoFocus
              defaultValue={d.text}
              placeholder="Name this area"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
              onBlur={(e) => { setNote(id, { text: e.target.value }); setEdit(false); }}
            />
          ) : (
            <button className="note-box-title nodrag" onClick={() => setEdit(true)} style={{ color: d.color }}>
              {d.text || <span className="muted">Name this area</span>}
            </button>
          )}
        </div>
      </>
    );
  }
  return (
    <div className="note-text" style={{ color: d.color, fontSize: d.size ?? 24 }} onDoubleClick={() => setEdit(true)}>
      {edit ? (
        <input
          className="nodrag"
          autoFocus
          defaultValue={d.text}
          style={{ fontSize: d.size ?? 24, color: d.color }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
          onBlur={(e) => { setNote(id, { text: e.target.value || 'Label' }); setEdit(false); }}
        />
      ) : d.text}
    </div>
  );
}

export default memo(NoteNodeView);
