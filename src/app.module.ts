import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

import { StudentsModule } from './students/students.module';
import { StaffModule } from './staff/staff.module';
import { LecturersModule } from './lecturers/lecturers.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { AcademicsModule } from './academics/academics.module';
import { CourseRegistrationModule } from './course-registration/course-registration.module';
import { FinanceModule } from './finance/finance.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ResultsModule } from './results/results.module';
import { CbtModule } from './cbt/cbt.module';
import { AttendanceModule } from './attendance/attendance.module';
import { IdCardsModule } from './id-cards/id-cards.module';
import { CommunicationModule } from './communication/communication.module';
import { ReportsModule } from './reports/reports.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DocumentsModule } from './documents/documents.module';
import { SettingsModule } from './settings/settings.module';
import { SecurityModule } from './security/security.module';
import { SystemAdminModule } from './system-admin/system-admin.module';
import { WebsiteCmsModule } from './website-cms/website-cms.module';
import { HealthModule } from './health/health.module';
import { ContactModule } from './contact/contact.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    StudentsModule,
    StaffModule,
    LecturersModule,
    AdmissionsModule,
    AcademicsModule,
    CourseRegistrationModule,
    FinanceModule,
    ReceiptsModule,
    ResultsModule,
    CbtModule,
    AttendanceModule,
    IdCardsModule,
    CommunicationModule,
    ReportsModule,
    AnalyticsModule,
    DocumentsModule,
    SettingsModule,
    SecurityModule,
    SystemAdminModule,
    WebsiteCmsModule,
    HealthModule,
    ContactModule,
    MailModule,
  ],
})
export class AppModule {}
