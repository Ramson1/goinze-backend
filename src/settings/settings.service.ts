import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Settings: school settings stored as key/value JSON pairs, plus the
 * school profile record.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get all settings for a school as a key -> value map. */
  async getAll(schoolId: string | null): Promise<Record<string, any>> {
    if (!schoolId) return {};
    const settings = await this.prisma.db.schoolSetting.findMany({
      where: { schoolId },
    });
    return settings.reduce<Record<string, any>>((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {});
  }

  /** Upsert a single setting key/value. */
  upsert(schoolId: string | null, key: string, value: any) {
    return this.prisma.db.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: schoolId ?? '', key } },
      create: { schoolId: schoolId ?? '', key, value },
      update: { value },
    });
  }

  /** Bulk upsert settings. */
  async updateMany(
    schoolId: string | null,
    entries: Record<string, any>,
  ): Promise<{ updated: number }> {
    const keys = Object.keys(entries);
    await this.prisma.db.$transaction(
      keys.map((key) =>
        this.prisma.db.schoolSetting.upsert({
          where: { schoolId_key: { schoolId: schoolId ?? '', key } },
          create: { schoolId: schoolId ?? '', key, value: entries[key] },
          update: { value: entries[key] },
        }),
      ),
    );
    return { updated: keys.length };
  }

  /** Get the school profile. */
  getProfile(schoolId: string | null) {
    if (!schoolId) return null;
    return this.prisma.db.school.findUnique({
      where: { id: schoolId },
      include: { subscription: true },
    });
  }

  /** Update the school profile. */
  updateProfile(schoolId: string | null, data: Record<string, any>) {
    return this.prisma.db.school.update({
      where: { id: schoolId ?? '' },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        logoUrl: data.logoUrl,
        faviconUrl: data.faviconUrl,
        primaryColor: data.primaryColor,
        website: data.website,
      },
    });
  }
}
