import React, { useState } from 'react';
import { handleExport, type ExportFormat } from './exportUtils';
import type { ScanSummary } from './types';
import { FileText, Table, FileSpreadsheet, Code } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: ScanSummary | null;
}

export const ExportModal = ({ isOpen, onClose, summary }: ExportModalProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const onExport = async (format: ExportFormat) => {
    if (!summary) return;
    setIsExporting(true);
    setError(null);
    try {
      const result = await handleExport(summary, format);
      if (result) {
        onClose();
      }
    } catch (err) {
      setError('Failed to export report');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl ring-1 ring-slate-800/60 overflow-hidden">
        <div className="border-b border-slate-800 p-4 bg-slate-900/80">
          <h3 className="text-lg font-semibold text-slate-100">
            Export Scan Report
          </h3>
          <p className="text-xs text-slate-500">
            Choose a format to export the scan results.
          </p>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 p-4">
          <button 
            className={cn(
              "h-24 flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed",
              isExporting && "opacity-50 cursor-wait"
            )}
            onClick={() => onExport('pdf')}
            disabled={isExporting}
          >
            <FileText className="h-8 w-8 text-red-400" />
            <span className="text-sm font-medium text-slate-300">PDF Report</span>
          </button>

          <button 
            className={cn(
              "h-24 flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed",
              isExporting && "opacity-50 cursor-wait"
            )}
            onClick={() => onExport('excel')}
            disabled={isExporting}
          >
            <Table className="h-8 w-8 text-green-400" />
            <span className="text-sm font-medium text-slate-300">Excel Export</span>
          </button>

          <button 
            className={cn(
              "h-24 flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed",
              isExporting && "opacity-50 cursor-wait"
            )}
            onClick={() => onExport('csv')}
            disabled={isExporting}
          >
            <FileSpreadsheet className="h-8 w-8 text-blue-400" />
            <span className="text-sm font-medium text-slate-300">CSV Data</span>
          </button>

          <button 
            className={cn(
              "h-24 flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed",
              isExporting && "opacity-50 cursor-wait"
            )}
            onClick={() => onExport('html')}
            disabled={isExporting}
          >
            <Code className="h-8 w-8 text-orange-400" />
            <span className="text-sm font-medium text-slate-300">HTML Summary</span>
          </button>
        </div>

        <div className="flex justify-end p-4 border-t border-slate-800 bg-slate-900/80">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md text-sm font-medium transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
