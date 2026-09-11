interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): JSX.Element | null => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60 scale-in duration-200">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-xl">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-md text-sm font-medium shadow-lg transition focus-visible:outline-none focus-visible:ring-2 ${
              isDestructive
                ? "bg-red-500/10 border border-red-500/50 text-red-200 hover:bg-red-500/20 focus-visible:ring-red-500/50"
                : "bg-blue-600 hover:bg-blue-500 text-white focus-visible:ring-blue-500/50"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
