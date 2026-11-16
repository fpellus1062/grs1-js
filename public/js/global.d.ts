/* eslint-disable @typescript-eslint/no-explicit-any */
// Globales inyectados en window por CDN o scripts externos.
// Se tipan como `any` para evitar falsos positivos del checker en JS puro.
interface GRS1BadgeOptions {
  escapeHtmlFn?: (value: string) => string;
  className?: string;
  variant?: string;
  fontSize?: string;
  padding?: string;
  maxWidth?: string;
  whiteSpace?: string;
  overflowWrap?: string;
  lineHeight?: string;
  cursor?: string;
  title?: string;
  contrastThreshold?: number;
}

interface GRS1Requisito {
  objetivo_total?: number;
  completado_total?: number;
  tipo?: string;
  plantilla_nombre?: string;
  pct?: number | null;
  estado?: string;
}

interface GRS1RequisitosRow {
  requisitos_detalle_pct?: GRS1Requisito[];
  requisitos_objetivo_total?: number;
  requisitos_completado_total?: number;
  requisitos_pct?: number | null;
}

interface GRS1UtilsApi {
  sameValue(left: unknown, right: unknown): boolean;
  cloneRows<T>(rows: T[]): T[];
  esc(value: unknown): string;
  isConsultaReadOnlyRole(appRef?: Record<string, any>): boolean;
  disableElementsById(ids: string[], titleText?: string): void;
  normalizeHexColor(value: unknown): string;
  getTextColorForHexBackground(color: unknown, threshold?: number): string;
  renderColorBadgeHtml(label: unknown, color: unknown, options?: GRS1BadgeOptions): string;
  getSemanticBadgeClass(tone?: string, variant?: string): string;
  renderSemanticBadgeHtml(label: unknown, tone?: string, options?: GRS1BadgeOptions): string;
  pdfHexToRgb(hex: unknown, fallback: number[]): number[];
  drawPdfBadgeFlow(
    doc: import('jspdf').jsPDF,
    badges: { label?: string; bg?: string; fg?: string }[],
    options?: { x?: number; y?: number; maxX?: number; badgeHeight?: number; gapX?: number; lineGap?: number; padX?: number; radius?: number; fontSize?: number; emptyLabel?: string }
  ): { endY: number };
  getRequisitoPctBadgeColors(pct: number | null): { bg: string; fg: string };
  getRequisitosDetalleVisible(rowData: GRS1RequisitosRow): GRS1Requisito[];
  buildRequisitosResumenTexto(rowData: GRS1RequisitosRow): string;
  formatRequisitosEstado(estado: unknown): string;
  buildRequisitosTooltip(rowData: GRS1RequisitosRow): string;
  renderRequisitosBadgesHtml(rowData: GRS1RequisitosRow, escapeHtmlFn?: (value: string) => string): string;
}

interface Window {
  GRS1Dashboard: Record<string, any>;
  GRS1Utils: GRS1UtilsApi;
  luxon: any;
  bootstrap: any;
  Tabulator: any;
  XLSX: any;
  jspdf: any;
  DOMPurify: any;
  HelpWidget: any;
  echarts: any;
  GRS1TabulatorLangs: Record<string, any>;
  GRS1TabulatorQbe: Record<string, any>;
  openNuevoCuadranteModal: (...args: any[]) => any;
}

// Librerías cargadas por <script> que también se usan como variables globales.
declare const bootstrap: any;
declare const echarts: any;
declare const XLSX: any;
declare const Tabulator: any;
declare const luxon: any;
declare const DOMPurify: any;

// Los ids del DOM se consultan por nombre y el tipo real depende de la vista:
// se permite acceder a value/disabled/etc. sin castear en cada uso.
interface Document {
  getElementById(elementId: string): (HTMLElement & Record<string, any>) | null;
}

interface ParentNode {
  querySelector(selectors: string): (Element & Record<string, any>) | null;
  querySelectorAll(selectors: string): NodeListOf<Element & Record<string, any>>;
}
