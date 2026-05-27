/* eslint-disable @typescript-eslint/no-explicit-any */
// Globales de terceros inyectados en window por CDN o scripts externos.
// Se tipan como `any` para evitar falsos positivos del checker en JS puro.
interface Window {
  GRS1Dashboard: Record<string, any>;
  luxon: any;
  bootstrap: any;
  Tabulator: any;
  XLSX: any;
  DOMPurify: any;
  HelpWidget: any;
  echarts: any;
}
