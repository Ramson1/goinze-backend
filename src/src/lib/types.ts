// ============================================================
// Cross-app type contracts (inlined from @goinze/shared-types)
// ============================================================

export type Role =
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'ADMISSION_OFFICER'
  | 'ACCOUNTANT'
  | 'LECTURER'
  | 'STUDENT'
  | 'PARENT';

export const ROLES: Role[] = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'ADMISSION_OFFICER',
  'ACCOUNTANT',
  'LECTURER',
  'STUDENT',
  'PARENT',
];

/** Which portal each role lands in. */
export const ROLE_HOME: Record<Role, string> = {
  SUPER_ADMIN: '/admin',
  SCHOOL_ADMIN: '/admin',
  ADMISSION_OFFICER: '/admin/admissions',
  ACCOUNTANT: '/admin/finance',
  LECTURER: '/lecturer',
  STUDENT: '/student',
  PARENT: '/student',
};

export type SemesterKey = 'FIRST' | 'SECOND' | 'THIRD';

export type PaymentStatusKey =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED';

export type ApplicationStatusKey =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'INTERVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADMITTED';

// ---- Auth payloads ----
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  schoolId: string | null;
  permissions?: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  schoolId: string | null;
  avatarUrl?: string | null;
}

// ---- Generic API envelopes ----
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  success: false;
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

// ---- Grading ----
export interface GradeBand {
  grade: string;
  min: number;
  max: number;
  point: number;
  remark: string;
}

export interface GpaResult {
  totalUnits: number;
  totalPoints: number;
  gpa: number;
  classification: string;
}
