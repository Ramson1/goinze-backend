# Goinzeschool API (`@goinze/api`)

NestJS 10 REST API for the Goinzeschool Enterprise School Management ERP.

- **Port:** `4000` (override with `API_PORT`)
- **Global prefix:** `api/v1` → all routes are served under `http://localhost:4000/api/v1`
- **Auth:** JWT (access + refresh) with Role-Based Access Control (RBAC)
- **Validation:** global `ValidationPipe({ whitelist: true, transform: true })`
- **CORS:** enabled
- **Config:** `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })`)

## Workspace dependencies

This app consumes three pnpm workspace packages:

- `@goinze/database` — exports the shared `prisma` client singleton and re-exports all Prisma types/enums.
- `@goinze/shared-types` — `Role`, `ROLES`, `JwtPayload`, `AuthTokens`, `SessionUser`, `ApiResponse`, `Paginated`, etc.
- `@goinze/shared-utils` — `computeGpa`, `resolveGrade`, `generatePaymentRef`, `generateReceiptNumber`, `generateVerificationCode`, `generateApplicationNo`, `generateMatricNumber`, `generateCardNumber`, `generateResultPin`, `formatNaira`, `slugify`, `paginate`.

## Project structure

```
src/
├── main.ts                     # bootstrap (prefix, CORS, ValidationPipe, listen)
├── app.module.ts               # root module wiring every feature module
├── prisma/                     # global PrismaModule + PrismaService (wraps shared client)
├── common/
│   ├── decorators/             # @Roles, @Public, @CurrentUser
│   ├── guards/                 # JwtAuthGuard (respects @Public), RolesGuard
│   ├── dto/                    # PaginationDto
│   └── utils/                  # paginated() helper -> Paginated<T> envelope
├── auth/                       # register/login/refresh/logout/me + JwtStrategy
└── <feature>/                  # one folder per domain (module + controller + service [+ dto])
```

## Authentication & RBAC

- `JwtAuthGuard` validates the Bearer access token (passport-jwt) and attaches a `SessionUser`-shaped object to `request.user`. Routes/controllers marked `@Public()` bypass authentication.
- `RolesGuard` reads `@Roles(...)` metadata; if roles are declared the user's `role` must be included. Routes without `@Roles()` only require authentication.
- Roles: `SUPER_ADMIN`, `SCHOOL_ADMIN`, `ADMISSION_OFFICER`, `ACCOUNTANT`, `LECTURER`, `STUDENT`, `PARENT`.

## Endpoint map

All paths below are relative to `/api/v1`.

### Auth (`/auth`)
- `POST /auth/register` (public)
- `POST /auth/login` (public)
- `POST /auth/refresh` (public)
- `POST /auth/logout`
- `GET /auth/me`

### Students (`/students`)
- `GET /students` · `GET /students/:id` · `POST /students` · `POST /students/import` · `PATCH /students/:id` · `DELETE /students/:id`
- `PATCH /students/:id/suspend` · `PATCH /students/:id/graduate` · `PATCH /students/:id/archive`

### Staff (`/staff`)
- `GET /staff` · `GET /staff/:id` · `POST /staff` · `PATCH /staff/:id` · `DELETE /staff/:id`

### Admissions (`/admissions`)
- `POST /admissions/apply` (public)
- `GET /admissions` · `GET /admissions/:id`
- `PATCH /admissions/:id/review` · `PATCH /admissions/:id/approve` · `POST /admissions/:id/letter`

### Academics (`/academics`)
- Faculties: `GET/POST /academics/faculties`
- Departments: `GET/POST /academics/departments`
- Programmes: `GET/POST /academics/programmes`
- Sessions: `GET/POST /academics/sessions`
- Courses: `GET/POST /academics/courses` · `GET /academics/courses/:id`
- Allocation: `GET /academics/courses/:id/allocations` · `POST /academics/course-allocations`

### Course Registration (`/course-registrations`)
- `POST /course-registrations` · `GET /course-registrations/student/:studentId` · `GET /course-registrations/:id`
- `POST /course-registrations/:id/courses` · `DELETE /course-registrations/:id/courses/:courseId`
- `PATCH /course-registrations/:id/approve` · `PATCH /course-registrations/:id/lock`

### Finance (`/finance`)
- Fee structures: `GET/POST /finance/fee-structures`
- Payments: `GET /finance/payments` · `POST /finance/payments/init` · `POST /finance/payments/verify`
- Refunds: `POST /finance/refunds`
- Scholarships: `GET/POST /finance/scholarships`
- Ledger: `GET /finance/ledger/:studentId`
- Dashboard: `GET /finance/dashboard`

### Receipts (`/receipts`)
- `POST /receipts/payment/:paymentId` · `GET /receipts/payment/:paymentId`
- `GET /receipts/verify/:code` (public)

### Results (`/results`)
- `POST /results/scores` · `POST /results/bulk-upload`
- `GET /results/student/:studentId` · `GET /results/student/:studentId/gpa`
- `PATCH /results/:id/approve` · `PATCH /results/:id/lock` · `PATCH /results/:id/publish`
- Pins: `POST /results/pins` · `POST /results/pins/verify`

### CBT (`/cbt`)
- Question banks: `GET/POST /cbt/question-banks`
- Questions: `GET /cbt/question-banks/:bankId/questions` · `POST /cbt/questions`
- Exams: `GET/POST /cbt/exams` · `GET /cbt/exams/:id` · `POST /cbt/exams/:id/questions` · `GET /cbt/exams/:id/attempts`
- Attempts: `POST /cbt/attempts/start` · `POST /cbt/attempts/:id/submit` (auto-grades objective questions)

### Attendance (`/attendance`)
- `POST /attendance/mark` · `POST /attendance/qr` · `POST /attendance/digital-id`
- `GET /attendance` · `GET /attendance/report/:studentId`

### ID Cards (`/id-cards`)
- `POST /id-cards` · `GET /id-cards` · `PATCH /id-cards/:id/revoke`
- `GET /id-cards/verify/:code` (public)

### Communication (`/communication`)
- Announcements: `GET/POST /communication/announcements`
- Messages: `GET/POST /communication/messages` · `PATCH /communication/messages/:id/read`
- Notifications: `GET/POST /communication/notifications` · `PATCH /communication/notifications/:id/read`

### Reports (`/reports`)
- `GET /reports/students` · `/reports/admissions` · `/reports/payments` · `/reports/results` · `/reports/attendance`

### Analytics (`/analytics`)
- `GET /analytics/dashboard` · `/analytics/admissions-trend` · `/analytics/revenue`

### Documents (`/documents`)
- `POST /documents` · `GET /documents` · `GET /documents/student/:studentId` · `DELETE /documents/:id`

### Settings (`/settings`)
- `GET /settings` · `PUT /settings` · `PATCH /settings/:key`
- `GET /settings/profile` · `PATCH /settings/profile`

### Security (`/security`)
- `GET /security/audit-logs` · `GET /security/login-history/:userId`
- `GET /security/permissions` · `GET /security/permissions/user/:userId` · `POST /security/permissions/grant`

### System Admin (`/system-admin`) — `SUPER_ADMIN` only
- Schools: `GET/POST /system-admin/schools` · `GET/PUT/DELETE /system-admin/schools/:id`
- Subscriptions: `GET/POST /system-admin/subscriptions`
- Maintenance: `PATCH /system-admin/schools/:id/maintenance`

### Website CMS (`/website`)
- Public reads: `GET /website/content` · `/website/news` · `/website/news/:slug` · `/website/events` · `/website/gallery`
- Admin writes: `POST /website/content` · `/website/news` · `/website/events` · `/website/gallery`

### Health (`/health`)
- `GET /health` (public) → `{ status: 'ok', uptime, timestamp }`

## Scripts

- `pnpm dev` — `nest start --watch`
- `pnpm build` — `nest build`
- `pnpm start` / `pnpm start:prod` — `node dist/main.js`
- `pnpm lint` — ESLint over `src/**/*.ts`
- `pnpm typecheck` — `tsc --noEmit`

## Notes / assumptions

- `PrismaService` is a thin injectable wrapper exposing the shared `prisma` singleton from `@goinze/database` via `client`/`db` getters; `PrismaModule` is global.
- Multi-tenancy is enforced by scoping queries with the authenticated user's `schoolId` (super admins with a null `schoolId` see all records).
- Gateway integrations (Flutterwave checkout, Cloudinary uploads, PDF generation) are stubbed and return placeholder URLs; only the metadata/records are persisted.
- The Prisma client must be generated (`pnpm db:generate` at the repo root) before `tsc`/`nest build` will fully resolve model types.
