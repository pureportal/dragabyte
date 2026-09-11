import { useEffect, useRef, useState } from "react";

interface InputModalProps {
  isOpen: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const InputModal = ({
  isOpen,
  title,
  label,
  defaultValue = "",
  placeholder = "",
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onSubmit,
  onCancel,
}: InputModalProps): JSX.Element | null => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValue(defaultValue);
    // Focus after a short delay to ensure modal is rendered
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60 scale-in duration-200">
        <form onSubmit={handleSubmit}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">
              {title}
            </h3>
            <label className="block text-xs font-medium uppercase text-slate-500 mb-1.5">
              {label}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>
          <div className="flex justify-end gap-3 p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-xl">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
