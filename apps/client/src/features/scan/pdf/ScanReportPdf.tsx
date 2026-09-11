// @ts-ignore
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatBytes } from '../../../lib/utils';
import type { ScanSummary } from '../types';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#333333',
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: '#2563EB', // Blue-600
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  headerLeft: {
    flexDirection: 'column',
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937', // Gray-800
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: '#6B7280', // Gray-500
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 10,
    marginTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F3F4F6', // Gray-100
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  statValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2563EB',
  },
  table: {
    display: 'flex',
    width: 'auto',
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#9CA3AF',
    alignItems: 'center',
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    alignItems: 'center',
    paddingVertical: 4,
    minHeight: 20,
  },
  colName: { width: '30%', paddingHorizontal: 4 },
  colPath: { width: '50%', paddingHorizontal: 4, color: '#6B7280' },
  colSize: { width: '20%', paddingHorizontal: 4, textAlign: 'right' },
  
  textSmall: {
    fontSize: 9,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: '#9CA3AF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
  },
});

interface ScanReportPdfProps {
  summary: ScanSummary;
  date: string;
}

export const ScanReportPdf = ({ summary, date }: ScanReportPdfProps) => {
  // Get top 50 largest files (increased from 20)
  const largestFiles = summary.largestFiles.slice(0, 50);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Scan Report</Text>
            <Text style={styles.subtitle}>Dragabyte Disk Analyzer</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.subtitle}>Generated: {date}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Size</Text>
            <Text style={styles.statValue}>{formatBytes(summary.totalBytes)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Files</Text>
            <Text style={styles.statValue}>{summary.fileCount.toLocaleString()}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Folders</Text>
            <Text style={styles.statValue}>{summary.dirCount.toLocaleString()}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{(summary.durationMs / 1000).toFixed(2)}s</Text>
          </View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Scan Summary</Text>
          <Text style={{ marginBottom: 4 }}>Root Path: {summary.root.path}</Text>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Largest Files</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.colName, { fontWeight: 'bold' }]}>Name</Text>
              <Text style={[styles.colPath, { fontWeight: 'bold' }]}>Path</Text>
              <Text style={[styles.colSize, { fontWeight: 'bold' }]}>Size</Text>
            </View>
            {largestFiles.map((file, i) => (
              <View style={styles.tableRow} key={i}>
                <Text style={[styles.colName, styles.textSmall]}>{file.name}</Text>
                <Text style={[styles.colPath, styles.textSmall, { fontSize: 8 }]}>{file.path}</Text>
                <Text style={[styles.colSize, styles.textSmall]}>{formatBytes(file.sizeBytes)}</Text>
              </View>
            ))}
          </View>
        </View>
        
        <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
          `${pageNumber} / ${totalPages}`
        )} fixed />
      </Page>
    </Document>
  );
};
