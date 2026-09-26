/**
 * 2026/2027 tuition & fee policy — single source of truth.
 *
 * Rules enforced server-side everywhere fees are assembled or paid:
 *  1. Returning students (currentLevel >= 200) pay ONLY the portal access fee
 *     plus their department tuition; every other fee type is excluded.
 *  2. Returning tuition is fixed per department code:
 *     CHEW 124,500 · MLT 134,500 · PHT 129,500 · PT 134,500.
 *  3. Scholarship students (any level) pay a flat 87,000 tuition for any
 *     department, with the portal access fee still charged on top.
 *  4. Entering regular students (100 level) keep the configured fee structures.
 *
 * When a policy tuition applies but no SCHOOL fee structure row exists for the
 * student, a virtual tuition item (POLICY_TUITION_FEE_ID) is synthesized so the
 * correct amount always shows. Payments for that virtual item carry
 * metadata.purpose = 'POLICY_TUITION' (no FeeStructure FK row exists for it).
 */

/** Stable id of the synthesized (virtual) tuition item. Not a DB row. */
export const POLICY_TUITION_FEE_ID = 'policy-tuition';

/** Payment metadata purpose tag used to reconcile virtual-tuition payments. */
export const POLICY_TUITION_PURPOSE = 'POLICY_TUITION';

/** Flat tuition for scholarship students, any department / any level. */
export const SCHOLARSHIP_TUITION_AMOUNT = 87000;

/** Students at this level and above are "returning". */
export const RETURNING_MIN_LEVEL = 200;

/** Returning tuition by department code (matched case-insensitively). */
export const RETURNING_TUITION_BY_DEPARTMENT_CODE: Record<string, number> = {
  CHEW: 124500,
  MLT: 134500,
  PHT: 129500,
  PT: 134500,
};

/** The only fee types a returning student may be charged. */
export const RETURNING_ALLOWED_TYPES: string[] = ['PORTAL_ACCESS', 'SCHOOL'];

export interface FeePolicyContext {
  currentLevel: number | null;
  departmentCode: string | null;
  isScholarship: boolean;
  /** Session/semester stamped onto a synthesized tuition item for grouping. */
  sessionId?: string | null;
  semester?: string | null;
}

/** Minimal fee-structure shape the policy operates on. */
export interface PolicyFeeInput {
  id: string;
  name: string;
  type: string;
  amount: unknown;
  isMandatory: boolean;
  semester?: string | null;
  sessionId?: string | null;
}

export interface PolicyFeeItem {
  id: string;
  name: string;
  type: string;
  amount: number;
  isMandatory: boolean;
  semester: string | null;
  sessionId: string | null;
}

/** True when the student is returning (200 level and above). */
export function isReturningLevel(currentLevel: number | null | undefined): boolean {
  return (currentLevel ?? 100) >= RETURNING_MIN_LEVEL;
}

/**
 * The policy tuition for a student, or null when no policy amount applies
 * (entering regular students, or returning students in an unmapped department).
 */
export function policyTuitionAmount(ctx: FeePolicyContext): number | null {
  if (ctx.isScholarship) return SCHOLARSHIP_TUITION_AMOUNT;
  if (!isReturningLevel(ctx.currentLevel)) return null;
  const code = (ctx.departmentCode ?? '').trim().toUpperCase();
  return RETURNING_TUITION_BY_DEPARTMENT_CODE[code] ?? null;
}

/**
 * Apply the fee policy to a list of fee structures:
 *  - returning students: keep only PORTAL_ACCESS + SCHOOL items;
 *  - policy tuition (scholarship / returning mapped department): overrides the
 *    amount of every remaining SCHOOL item;
 *  - if no SCHOOL item remains while a policy tuition applies, synthesize one.
 */
export function applyFeePolicy(structures: PolicyFeeInput[], ctx: FeePolicyContext): PolicyFeeItem[] {
  const tuition = policyTuitionAmount(ctx);

  let items: PolicyFeeItem[] = structures.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    amount: Number(f.amount),
    isMandatory: f.isMandatory,
    semester: f.semester ?? null,
    sessionId: f.sessionId ?? null,
  }));

  if (isReturningLevel(ctx.currentLevel)) {
    items = items.filter((f) => RETURNING_ALLOWED_TYPES.includes(f.type));
  }

  if (tuition != null) {
    items = items.map((f) => (f.type === 'SCHOOL' ? { ...f, amount: tuition } : f));
    if (!items.some((f) => f.type === 'SCHOOL')) {
      items.push({
        id: POLICY_TUITION_FEE_ID,
        name: ctx.isScholarship ? 'Tuition Fee (Scholarship)' : 'Tuition Fee',
        type: 'SCHOOL',
        amount: tuition,
        isMandatory: true,
        semester: ctx.semester ?? 'FIRST',
        sessionId: ctx.sessionId ?? null,
      });
    }
  }

  return items;
}
