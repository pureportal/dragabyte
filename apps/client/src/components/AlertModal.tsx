interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  buttonLabel?: string;
  onClose: () => void;
}

export const AlertModal = ({
  isOpen,
  title,
  message,
  buttonLabel = "OK",
  onClose,
}: AlertModalProps): JSX.Element | null => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60 scale-in duration-200">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
