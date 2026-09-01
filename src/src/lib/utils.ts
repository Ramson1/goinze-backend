import type { GradeBand, GpaResult } from './types';

// ============================================================
// Pure helpers (inlined from @goinze/shared-utils)
// ============================================================

/** Standard 5-point grading scale (Nigerian tertiary default). */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { grade: 'A', min: 70, max: 100, point: 5, remark: 'Excellent' },
  { grade: 'B', min: 60, max: 69, point: 4, remark: 'Very Good' },
  { grade: 'C', min: 50, max: 59, point: 3, remark: 'Good' },
  { grade: 'D', min: 45, max: 49, point: 2, remark: 'Pass' },
  { grade: 'E', min: 40, max: 44, point: 1, remark: 'Weak Pass' },
  { grade: 'F', min: 0, max: 39, point: 0, remark: 'Fail' },
];

/** Resolve a numeric score into a grade band. */
export function resolveGrade(
  score: number,
  bands: GradeBand[] = DEFAULT_GRADE_BANDS,
): GradeBand {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    bands.find((b) => clamped >= b.min && clamped <= b.max) ??
    bands[bands.length - 1]!
  );
}

export interface CourseGrade {
  creditUnits: number;
  score: number;
}

/** Compute GPA/CGPA from a list of graded courses. */
export function computeGpa(
  courses: CourseGrade[],
  bands: GradeBand[] = DEFAULT_GRADE_BANDS,
): GpaResult {
  let totalUnits = 0;
  let totalPoints = 0;

  for (const c of courses) {
    const band = resolveGrade(c.score, bands);
    totalUnits += c.creditUnits;
    totalPoints += band.point * c.creditUnits;
  }

  const gpa = totalUnits > 0 ? totalPoints / totalUnits : 0;
  return {
    totalUnits,
    totalPoints,
    gpa: round(gpa, 2),
    classification: classifyGpa(gpa),
  };
}

export function classifyGpa(gpa: number): string {
  if (gpa >= 4.5) return 'First Class';
  if (gpa >= 3.5) return 'Second Class Upper';
  if (gpa >= 2.4) return 'Second Class Lower';
  if (gpa >= 1.5) return 'Third Class';
  if (gpa >= 1.0) return 'Pass';
  return 'Fail';
}

export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// ---- Reference / code generators ----

function randomDigits(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function randomAlpha(n: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Payment reference, e.g. GIS-PAY-20260725-8F3K1Q */
export function generatePaymentRef(prefix = 'GIS-PAY'): string {
  return `${prefix}-${dateStamp()}-${randomAlpha(6)}`;
}

/** Human-friendly receipt number, e.g. RCP-20260725-004213 */
export function generateReceiptNumber(): string {
  return `RCP-${dateStamp()}-${randomDigits(6)}`;
}

/** Short verification code for receipts / ID cards, e.g. 7K2P-9QX4 */
export function generateVerificationCode(): string {
  return `${randomAlpha(4)}-${randomAlpha(4)}`;
}

/** Application number, e.g. APP/2026/0004213 */
export function generateApplicationNo(year = new Date().getFullYear()): string {
  return `APP/${year}/${randomDigits(7)}`;
}

/**
 * Matric number, e.g. GDU/CSC/2026/0421
 */
export function generateMatricNumber(
  schoolCode: string,
  deptCode: string,
  serial: number,
  year = new Date().getFullYear(),
): string {
  return `${schoolCode}/${deptCode}/${year}/${String(serial).padStart(4, '0')}`;
}

/** ID card number, e.g. GDU-ID-2026-3F9K1Q */
export function generateCardNumber(schoolCode: string): string {
  return `${schoolCode}-ID-${new Date().getFullYear()}-${randomAlpha(6)}`;
}

/** Result checker PIN, e.g. 1234-5678-9012 */
export function generateResultPin(): string {
  return `${randomDigits(4)}-${randomDigits(4)}-${randomDigits(4)}`;
}

function dateStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// ---- Academic session ----

export function currentAcademicSession(date = new Date()): string {
  const year = date.getFullYear();
  return date.getMonth() >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

// ---- Formatting ----

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function fullName(first: string, last: string, middle?: string | null): string {
  return [first, middle, last].filter(Boolean).join(' ');
}

export function paginate(page = 1, pageSize = 20) {
  const p = Math.max(1, Math.floor(page));
  const size = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}
