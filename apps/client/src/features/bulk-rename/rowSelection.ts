export interface RowSelection {
  selected: Set<string>;
  focused: string | null;
  anchor: string | null;
  rangeBase: Set<string> | null;
}

export const emptySelection = (): RowSelection => ({
  selected: new Set(),
  focused: null,
  anchor: null,
  rangeBase: null,
});

export function selectRow(
  state: RowSelection,
  ids: string[],
  id: string,
  range: boolean,
  toggle = false,
): RowSelection {
  if (range && state.anchor && ids.includes(state.anchor)) {
    const start = ids.indexOf(state.anchor);
    const end = ids.indexOf(id);
    const base = state.rangeBase ?? new Set(state.selected);
    return {
      ...state,
      focused: id,
      rangeBase: base,
      selected: new Set([
        ...base,
        ...ids.slice(Math.min(start, end), Math.max(start, end) + 1),
      ]),
    };
  }
  const selected = new Set(state.selected);
  if (toggle && selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, focused: id, anchor: id, rangeBase: null };
}
