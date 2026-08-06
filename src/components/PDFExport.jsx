// Component: PDFExport
// TODO: Use jsPDF + html2canvas to capture the report and download as PDF
// Button triggers snapshot of the printable report section

export default function PDFExport({ reportRef, fileName }) {
  const handleExport = async () => {
    // TODO: implement pdf generation
    console.log('PDF export triggered for:', fileName);
  };

  return (
    <button onClick={handleExport}>
      Export as PDF (placeholder)
    </button>
  );
}
