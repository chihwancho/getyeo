// src/services/pdfService.ts
import PDFDocument from 'pdfkit';
import axios from 'axios';
import { Coordinates } from '../types';

export interface ActivityForPDF {
  name: string;
  type: string;
  location: string;
  time: string | null;
  duration: number | null;
  priority: string;
  source: string;
  notes: string | null;
  reasoning: string | null;
  coordinates?: Coordinates;
}

export interface DayForPDF {
  date: string;
  theme?: string;
  homestayName?: string;
  activities: ActivityForPDF[];
  warnings: string[];
}

export interface VacationForPDF {
  name: string;
  startDate: string;
  endDate: string;
  days: DayForPDF[];
  summary?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const COLORS = {
  primary:     '#111827',
  muted:       '#6b7280',
  subtle:      '#9ca3af',
  rule:        '#e5e7eb',
  warn_fg:     '#92400e',
  warn_bg:     '#fffbeb',
  RESTAURANT:  '#ef4444',
  SIGHTSEEING: '#2563eb',
  ACTIVITY:    '#059669',
  TRAVEL:      '#d97706',
};

const MARGIN = 48;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TIME_W = 68;       // width of the time column
const BAR_W = 3;         // left accent bar width
const BAR_GAP = 8;       // gap after the bar before text
const TEXT_X = MARGIN + BAR_W + BAR_GAP;
const TEXT_W = CONTENT_WIDTH - BAR_W - BAR_GAP;
const TIME_TEXT_X = TEXT_X + TIME_W;
const TIME_TEXT_W = TEXT_W - TIME_W;

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  RESTAURANT:  { label: 'Restaurant',  color: COLORS.RESTAURANT },
  SIGHTSEEING: { label: 'Sightseeing', color: COLORS.SIGHTSEEING },
  ACTIVITY:    { label: 'Activity',    color: COLORS.ACTIVITY },
  TRAVEL:      { label: 'Travel',      color: COLORS.TRAVEL },
};

// ============================================================================
// HELPERS
// ============================================================================

const sanitize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
    .replace(/\u2014/g, '-')          // em dash -> hyphen
    .replace(/\u2013/g, '-')          // en dash -> hyphen
    .replace(/\u2019/g, "'")          // right single quote -> apostrophe
    .replace(/\u2018/g, "'")          // left single quote -> apostrophe
    .replace(/\u201c/g, '"')          // left double quote
    .replace(/\u201d/g, '"')          // right double quote
    .replace(/[^\x00-\x7F]/g, '');    // strip remaining non-ASCII

const fmt12 = (time: string | null): string => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDur = (min: number | null): string => {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

const hRule = (doc: PDFKit.PDFDocument, y: number) =>
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).stroke(COLORS.rule);

const fetchStaticMap = async (activities: ActivityForPDF[], apiKey: string): Promise<Buffer | null> => {
  const pts = activities.filter((a) => a.coordinates);
  if (pts.length === 0) return null;
  try {
    const markers = pts.map((a, i) =>
      `markers=color:0x2563eb|label:${i + 1}|${a.coordinates!.lat},${a.coordinates!.lng}`
    ).join('&');
    const path = pts.length > 1
      ? `&path=color:0x2563eb60|weight:2|${pts.map((a) => `${a.coordinates!.lat},${a.coordinates!.lng}`).join('|')}`
      : '';
    const zoom = pts.length < 3 ? '&zoom=14' : '';
    const url = `https://maps.googleapis.com/maps/api/staticmap?size=500x150&scale=2&maptype=roadmap&${markers}${path}${zoom}&key=${apiKey}`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    return Buffer.from(res.data);
  } catch { return null; }
};

// ============================================================================
// PDF GENERATION
// ============================================================================

export const generateItineraryPDF = async (vacation: VacationForPDF): Promise<Buffer> => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? '';

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: sanitize(vacation.name) } });
  const chunks: Buffer[] = [];
  const pdfDone = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = MARGIN;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  try {
    // ========================================================================
    // HEADER
    // ========================================================================

    doc.fillColor(COLORS.primary).fontSize(22).font('Helvetica-Bold')
      .text(sanitize(vacation.name), MARGIN, y);
    y += 26;

    doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica')
      .text(`${vacation.startDate}  -  ${vacation.endDate}  |  ${vacation.days.length} days`, MARGIN, y);
    y += 10;
    hRule(doc, y); y += 18;

    // ========================================================================
    // DAYS — continuous flow
    // ========================================================================

    for (const day of vacation.days) {
      const dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });

      checkPage(36);

      // Day heading
      if (day.theme) {
        doc.fillColor(COLORS.primary).fontSize(14).font('Helvetica-Bold')
          .text(sanitize(day.theme), MARGIN, y);
        y += 18;
        const subtitle = [sanitize(dateLabel), day.homestayName ? sanitize(day.homestayName) : '']
          .filter(Boolean).join('  |  ');
        doc.fillColor(COLORS.muted).fontSize(8.5).font('Helvetica').text(subtitle, MARGIN, y);
      } else {
        const heading = [sanitize(dateLabel), day.homestayName ? sanitize(day.homestayName) : '']
          .filter(Boolean).join('  |  ');
        doc.fillColor(COLORS.primary).fontSize(12).font('Helvetica-Bold').text(heading, MARGIN, y);
      }
      y += 14;
      hRule(doc, y); y += 12;

      // Static map
      if (apiKey) {
        const mapBuf = await fetchStaticMap(day.activities, apiKey);
        if (mapBuf) {
          checkPage(125);
          doc.image(mapBuf, MARGIN, y, { width: CONTENT_WIDTH, height: 115 });
          y += 123;
        }
      }

      // Activities
      for (let i = 0; i < day.activities.length; i++) {
        const a = day.activities[i];
        const cfg = TYPE_CONFIG[a.type] ?? { label: a.type, color: COLORS.muted };
        const timeStr = fmt12(a.time);
        const durStr = fmtDur(a.duration);
        const snippet = a.notes ?? a.reasoning;
        const snippetH = snippet ? (Math.ceil(sanitize(snippet).length / 75) * 10) + 4 : 0;

        // Estimate total height for this activity block
        const blockH = 14 + 12 + snippetH + 10;
        checkPage(blockH);

        const top = y;

        // Colored left accent bar — full height of the block
        doc.rect(MARGIN, top, BAR_W, blockH - 6).fill(cfg.color);

        // Time (above name, in time column)
        if (timeStr) {
          doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold')
            .text(timeStr, TEXT_X, top, { width: TIME_W - 4, lineBreak: false });
        }
        if (durStr) {
          doc.fillColor(COLORS.subtle).fontSize(7.5).font('Helvetica')
            .text(durStr, TEXT_X, top + (timeStr ? 11 : 0), { width: TIME_W - 4, lineBreak: false });
        }

        // Activity name — larger, bold
        doc.fillColor(COLORS.primary).fontSize(10.5).font('Helvetica-Bold')
          .text(sanitize(a.name), TIME_TEXT_X, top, { width: TIME_TEXT_W, lineBreak: false });

        // Type label + location on next line
        const metaY = top + 13;
        doc.fillColor(cfg.color).fontSize(7.5).font('Helvetica-Bold')
          .text(cfg.label, TIME_TEXT_X, metaY, { continued: true })
          .fillColor(COLORS.muted).font('Helvetica')
          .text(`   ${sanitize(a.location)}`, { width: TIME_TEXT_W - 4, lineBreak: false });

        y = metaY + 12;

        // Snippet
        if (snippet) {
          doc.fillColor(COLORS.subtle).fontSize(7.5).font('Helvetica')
            .text(sanitize(snippet), TIME_TEXT_X, y, { width: TIME_TEXT_W });
          y = doc.y + 3;
        }

        y += 8;

        // Light separator between activities
        if (i < day.activities.length - 1) {
          doc.moveTo(TIME_TEXT_X, y - 4)
            .lineTo(MARGIN + CONTENT_WIDTH, y - 4)
            .lineWidth(0.3).stroke('#f3f4f6');
        }
      }

      // Warnings
      if (day.warnings.length > 0) {
        checkPage(14 + day.warnings.length * 14);
        y += 2;
        doc.rect(MARGIN, y, CONTENT_WIDTH, day.warnings.length * 14 + 12)
          .fill(COLORS.warn_bg);
        y += 6;
        for (const w of day.warnings) {
          doc.fillColor(COLORS.warn_fg).fontSize(7.5).font('Helvetica')
            .text(`(!) ${sanitize(w)}`, MARGIN + 8, y, { width: CONTENT_WIDTH - 16 });
          y = doc.y + 3;
        }
        y += 4;
      }

      // Gap + rule between days
      y += 10;
      checkPage(16);
      hRule(doc, y); y += 16;
    }

    // ========================================================================
    // QUICK REFERENCE
    // ========================================================================

    checkPage(50);
    doc.fillColor(COLORS.primary).fontSize(13).font('Helvetica-Bold')
      .text('Quick Reference', MARGIN, y);
    y += 14; hRule(doc, y); y += 10;

    // Accommodation
    const homestays = [...new Set(vacation.days.filter((d) => d.homestayName).map((d) => d.homestayName!))];
    if (homestays.length) {
      doc.fillColor(COLORS.muted).fontSize(7.5).font('Helvetica-Bold').text('ACCOMMODATION', MARGIN, y);
      y += 10;
      for (const h of homestays) {
        doc.fillColor(COLORS.primary).fontSize(8.5).font('Helvetica')
          .text(`- ${sanitize(h)}`, MARGIN + 8, y);
        y += 12;
      }
      y += 6;
    }

    // All reminders
    const allWarnings = vacation.days.flatMap((d) => d.warnings);
    if (allWarnings.length) {
      doc.fillColor(COLORS.muted).fontSize(7.5).font('Helvetica-Bold').text('NOTES & REMINDERS', MARGIN, y);
      y += 10;
      for (const w of allWarnings) {
        checkPage(16);
        doc.fillColor(COLORS.warn_fg).fontSize(8).font('Helvetica')
          .text(`- ${sanitize(w)}`, MARGIN + 8, y, { width: CONTENT_WIDTH - 8 });
        y = doc.y + 4;
      }
    }

    doc.end();
  } catch (err) {
    doc.end();
    throw err;
  }

  return pdfDone;
};