import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { pdf } from '@react-pdf/renderer';
import React, { createElement } from 'react';
import type { ScanSummary, ScanNode, ScanFile } from './types';
import { ScanReportPdf } from './pdf/ScanReportPdf';
import { formatBytes } from '../../lib/utils';

export type ExportFormat = 'pdf' | 'excel' | 'csv' | 'html';

interface ExportItem {
  path: string;
  name: string;
  type: 'file' | 'folder';
  sizeBytes: number;
  depth: number;
  extension: string;
  percentage: number;
  fileCount?: number;
  dirCount?: number;
}

const getExtension = (name: string, type: 'file' | 'folder'): string => {
  if (type === 'folder') return 'File Folder';
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return 'File';
  return name.slice(lastDot + 1).toUpperCase() + ' File';
};

const flattenScan = (summary: ScanSummary): ExportItem[] => {
  const items: ExportItem[] = [];
  const totalSize = summary.root.sizeBytes || 1; // Avoid division by zero

  // Interface for stack items including parent size for relative percentage
  interface StackItem { 
    node: ScanNode; 
    depth: number;
    parentSize: number;
  }

  const stack: StackItem[] = [{ 
    node: summary.root, 
    depth: 0,
    parentSize: totalSize 
  }];

  while (stack.length > 0) {
    const { node, depth, parentSize } = stack.pop()!;
    const percentage = parentSize > 0 ? (node.sizeBytes / parentSize) * 100 : 0;
    
    // Add folder
    items.push({
      path: node.path,
      name: node.name,
      type: 'folder',
      sizeBytes: node.sizeBytes,
      depth,
      extension: 'File Folder',
      percentage,
      fileCount: node.fileCount,
      dirCount: node.dirCount
    });

    // Add files
    for (const file of node.files) {
      const filePercentage = node.sizeBytes > 0 ? (file.sizeBytes / node.sizeBytes) * 100 : 0;
      items.push({
        path: file.path,
        name: file.name,
        type: 'file',
        sizeBytes: file.sizeBytes,
        depth: depth + 1,
        extension: getExtension(file.name, 'file'),
        percentage: filePercentage
      });
    }

    // Add children (push in reverse order to preserve order on pop)
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ 
        node: node.children[i]!, 
        depth: depth + 1,
        parentSize: node.sizeBytes 
      });
    }
  }

  return items;
};

const flattenLargestFiles = (summary: ScanSummary): ScanFile[] => {
  return summary.largestFiles;
};

export const exportToPdf = async (summary: ScanSummary, filename: string) => {
  // @ts-ignore - The types for @react-pdf/renderer are a bit strict about input, but this works at runtime
  const blob = await pdf(<ScanReportPdf summary={summary} date={new Date().toLocaleDateString()} />).toBlob();
  const buffer = await blob.arrayBuffer();
  await writeFile(filename, new Uint8Array(buffer));
};

export const exportToExcel = async (summary: ScanSummary, filename: string) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dragabyte';
  workbook.created = new Date();

  // --- Summary Sheet ---
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Property', key: 'prop', width: 20 },
    { header: 'Value', key: 'val', width: 30 },
  ];
  
  // Style summary header
  summarySheet.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = { 
    type: 'pattern', 
    pattern: 'solid', 
    fgColor: { argb: 'FF2563EB' } // Blue-600 
  };

  summarySheet.addRows([
    { prop: 'Root Path', val: summary.root.path },
    { prop: 'Total Size', val: formatBytes(summary.totalBytes) },
    { prop: 'Total Files', val: summary.fileCount.toLocaleString() },
    { prop: 'Total Folders', val: summary.dirCount.toLocaleString() },
    { prop: 'Scan Duration', val: `${(summary.durationMs / 1000).toFixed(2)} seconds` },
    { prop: 'Export Date', val: new Date().toLocaleString() },
  ]);

  // --- Details Sheet ---
  const sheet = workbook.addWorksheet('Details');
  
  sheet.columns = [
    { header: 'Name', key: 'name', width: 50 },
    { header: 'Extension', key: 'extension', width: 15 },
    { header: 'Size', key: 'sizeFormatted', width: 15 },
    { header: '% of Parent', key: 'percentage', width: 15 },
    { header: 'Size (Bytes)', key: 'sizeBytes', width: 20 },
    { header: 'Files', key: 'fileCount', width: 10 },
    { header: 'Folders', key: 'dirCount', width: 10 },
    { header: 'Full Path', key: 'path', width: 60 },
  ];

  // Header styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' } // Slate-800
  };
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 8 }
  };

  const items = flattenScan(summary);
  
  items.forEach(item => {
    // Tree hierarchy indentation
    const indent = '    '.repeat(item.depth);
    const row = sheet.addRow({
      name: indent + (item.type === 'folder' ? '📁 ' : '📄 ') + item.name,
      extension: item.extension,
      sizeFormatted: formatBytes(item.sizeBytes),
      percentage: item.percentage / 100, // For Excel percentage formatting
      sizeBytes: item.sizeBytes,
      fileCount: item.fileCount,
      dirCount: item.dirCount,
      path: item.path
    });

    // Percent bar using data bar formatting (not supported by simple addRow, strictly using internal cell styling)
    if (item.type === 'folder') {
       row.font = { bold: true };
    }
  });

  // Formatting columns
  sheet.getColumn('percentage').numFmt = '0.00%';
  sheet.getColumn('sizeBytes').numFmt = '#,##0';
  sheet.getColumn('fileCount').numFmt = '#,##0';
  sheet.getColumn('dirCount').numFmt = '#,##0';

  // Add Data Bar to Size Column (using conditional formatting)
  // Note: ExcelJS implementation of dataBar often requires specific options
  // sheet.addConditionalFormatting({
  //   ref: `E2:E${items.length + 1}`,
  //   rules: [
  //     {
  //       type: 'dataBar',
  //       priority: 1,
  //       gradient: true,
  //       color: { argb: 'FF60A5FA' },
  //       showValue: true,
  //     }
  //   ]
  // });

  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filename, new Uint8Array(buffer));
};

export const exportToCsv = async (summary: ScanSummary, filename: string) => {
  const items = flattenScan(summary);
  
  // Sort by path for comparability
  items.sort((a, b) => a.path.localeCompare(b.path));

  const csv = Papa.unparse(items.map(item => ({
    Path: item.path,
    Name: item.name,
    Type: item.extension,
    'Size (Bytes)': item.sizeBytes,
    'Size (Formatted)': formatBytes(item.sizeBytes),
    'Percentage': item.percentage.toFixed(2) + '%',
    'Files': item.fileCount ?? '',
    'Folders': item.dirCount ?? '',
    'Depth': item.depth
  })));
  
  await writeTextFile(filename, csv);
};

export const exportToHtml = async (summary: ScanSummary, filename: string) => {
  const items = flattenScan(summary);
  const rootSize = summary.root.sizeBytes;
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dragabyte Report - ${summary.root.name}</title>
  <style>
    :root { 
      --bg: #f8fafc; --surface: #ffffff; --text: #0f172a; --text-light: #64748b; 
      --border: #e2e8f0; --primary: #3b82f6; --primary-light: #eff6ff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a; --surface: #1e293b; --text: #f1f5f9; --text-light: #94a3b8;
        --border: #334155; --primary: #3b82f6; --primary-light: #1e293b;
      }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 4px 0; font-size: 1.5rem; }
    .meta { color: var(--text-light); font-size: 0.875rem; margin-bottom: 1rem; }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat-box { background: var(--primary-light); padding: 1rem; border-radius: 6px; border: 1px solid var(--border); }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--textarea-light); margin-bottom: 0.25rem; font-weight: 600; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: var(--primary); }

    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { text-align: left; padding: 12px 8px; border-bottom: 2px solid var(--border); color: var(--text-light); font-weight: 600; white-space: nowrap; position: sticky; top: 0; background: var(--surface); }
    td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:hover td { background: var(--primary-light); }
    
    .name-col { display: flex; align-items: center; gap: 8px; }
    .icon { width: 16px; height: 16px; opacity: 0.7; }
    .bar-container { background: var(--border); height: 6px; border-radius: 3px; width: 60px; overflow: hidden; margin-top: 4px; }
    .bar-fill { background: var(--primary); height: 100%; border-radius: 3px; }
    .size-cell { font-family: monospace; white-space: nowrap; }
    .path-cell { color: var(--text-light); font-size: 0.75rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    .indent-0 { padding-left: 0; }
    .indent-1 { padding-left: 20px; }
    .indent-2 { padding-left: 40px; }
    .indent-3 { padding-left: 60px; }
    .indent-4 { padding-left: 80px; }
    .indent-5 { padding-left: 100px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Scan Report</h1>
      <div class="meta">${summary.root.path} • Generated ${new Date().toLocaleString()}</div>
      
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Total Size</div>
          <div class="stat-value">${formatBytes(summary.totalBytes)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total Files</div>
          <div class="stat-value">${summary.fileCount.toLocaleString()}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total Folders</div>
          <div class="stat-value">${summary.dirCount.toLocaleString()}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Largest File</div>
          <div class="stat-value" style="font-size: 1rem; line-height: 1.5; display: flex; align-items: center; height: 100%;">
            ${summary.largestFiles[0] ? formatBytes(summary.largestFiles[0].sizeBytes) : 'N/A'}
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="overflow-x: auto;">
      <table id="scanTable">
        <thead>
          <tr onclick="sortTable(event)">
            <th style="cursor: pointer">Name ⇅</th>
            <th style="cursor: pointer">Type ⇅</th>
            <th style="cursor: pointer">Percentage</th>
            <th style="cursor: pointer">Size ⇅</th>
            <th>Files</th>
            <th>Folders</th>
            <th>Last Modified</th>
          </tr>
        </thead>
        <tbody>
          ${items.slice(0, 2000).map(item => { // Limit to 2000 rows for HTML performance
            const indentClass = `indent-${Math.min(item.depth, 5)}`;
            const icon = item.type === 'folder' 
              ? '<svg viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="currentColor" class="icon"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
            
            // Calculate global percentage for the bar
            const globalPercent = (item.sizeBytes / rootSize) * 100;
            
            return `
              <tr>
                <td>
                  <div class="name-col ${indentClass}">
                    ${icon}
                    <span>${item.name}</span>
                  </div>
                </td>
                <td>${item.extension}</td>
                <td>
                   <div style="font-size: 0.75rem;">${item.percentage.toFixed(1)}%</div>
                   <div class="bar-container">
                     <div class="bar-fill" style="width: ${Math.max(globalPercent, 1)}%"></div>
                   </div>
                </td>
                <td class="size-cell" data-bytes="${item.sizeBytes}">${formatBytes(item.sizeBytes)}</td>
                <td style="text-align: right; color: var(--text-light);">${item.fileCount?.toLocaleString() ?? '-'}</td>
                <td style="text-align: right; color: var(--text-light);">${item.dirCount?.toLocaleString() ?? '-'}</td>
                <td style="font-size: 0.75rem; color: var(--text-light);"> - </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ${items.length > 2000 ? '<div style="text-align: center; padding: 20px; color: var(--text-light); font-style: italic;">Showing first 2,000 items. Export to Excel for full dataset.</div>' : ''}
    </div>
  </div>
  <script>
    // Simple table sorter (placeholder for future enhancements)
    function sortTable(n) { console.log("Sorting not implemented in static HTML export"); }
  </script>
</body>
</html>
  `;

  await writeTextFile(filename, html);
};

export const handleExport = async (summary: ScanSummary | null, format: ExportFormat) => {
  if (!summary) return;

  const defaultName = `scan-report-${Date.now()}`;
  let extensions: string[] = [];
  let name = '';

  switch (format) {
    case 'pdf': extensions = ['pdf']; name = 'PDF Files'; break;
    case 'excel': extensions = ['xlsx']; name = 'Excel Files'; break;
    case 'csv': extensions = ['csv']; name = 'CSV Files'; break;
    case 'html': extensions = ['html']; name = 'HTML Files'; break;
  }

  const filePath = await save({
    defaultPath: `${defaultName}.${extensions[0]}`,
    filters: [{
      name,
      extensions
    }]
  });

  if (!filePath) return;

  try {
    switch (format) {
      case 'pdf': await exportToPdf(summary, filePath); break;
      case 'excel': await exportToExcel(summary, filePath); break;
      case 'csv': await exportToCsv(summary, filePath); break;
      case 'html': await exportToHtml(summary, filePath); break;
    }

    try {
      await invoke('open_path', { path: filePath });
    } catch (e) {
      console.error('Failed to auto-open file:', e);
    }
    
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
};
