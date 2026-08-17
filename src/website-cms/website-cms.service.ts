import { Injectable, NotFoundException } from '@nestjs/common';
import { slugify } from '../../lib/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../common/utils/cloudinary.service';

/**
 * Website CMS: website content blocks, news posts, events and gallery.
 * Public read endpoints are exposed via @Public() in the controller.
 */
@Injectable()
export class WebsiteCmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ---- Website content ----
  listContent(schoolId: string | null) {
    return this.prisma.db.websiteContent.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: { key: 'asc' },
    });
  }

  upsertContent(
    schoolId: string | null,
    data: { key: string; title?: string; body?: any },
  ) {
    return this.prisma.db.websiteContent.upsert({
      where: { schoolId_key: { schoolId: schoolId ?? '', key: data.key } },
      create: { schoolId: schoolId ?? '', key: data.key, title: data.title, body: data.body },
      update: { title: data.title, body: data.body },
    });
  }

  deleteContent(schoolId: string | null, key: string) {
    return this.prisma.db.websiteContent.delete({
      where: { schoolId_key: { schoolId: schoolId ?? '', key } },
    });
  }

  // ---- News posts ----
  listNews(schoolId: string | null, publishedOnly = false) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (publishedOnly) where.published = true;
    return this.prisma.db.newsPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getNewsBySlug(schoolId: string | null, slug: string) {
    const post = await this.prisma.db.newsPost.findFirst({
      where: { slug, ...(schoolId ? { schoolId } : {}) },
    });
    if (!post) throw new NotFoundException('News post not found');
    return post;
  }

  createNews(
    schoolId: string | null,
    data: {
      title: string;
      body: string;
      category?: string;
      excerpt?: string;
      coverUrl?: string;
      published?: boolean;
    },
  ) {
    return this.prisma.db.newsPost.create({
      data: {
        schoolId: schoolId ?? '',
        title: data.title,
        slug: slugify(data.title),
        body: data.body,
        category: data.category,
        excerpt: data.excerpt,
        coverUrl: data.coverUrl,
        published: data.published ?? false,
        publishedAt: data.published ? new Date() : undefined,
      },
    });
  }

  async setNewsPublished(id: string, published: boolean) {
    const post = await this.prisma.db.newsPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('News post not found');
    return this.prisma.db.newsPost.update({
      where: { id },
      data: {
        published,
        publishedAt: published ? new Date() : null,
      },
    });
  }

  async updateNews(
    id: string,
    data: {
      title?: string;
      body?: string;
      category?: string;
      excerpt?: string;
      coverUrl?: string;
      published?: boolean;
    },
  ) {
    const post = await this.prisma.db.newsPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('News post not found');
    const updateData: Record<string, any> = {};
    if (data.title !== undefined) {
      updateData.title = data.title;
      updateData.slug = slugify(data.title);
    }
    if (data.body !== undefined) updateData.body = data.body;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.excerpt !== undefined) updateData.excerpt = data.excerpt;
    if (data.coverUrl !== undefined) updateData.coverUrl = data.coverUrl;
    if (data.published !== undefined) {
      updateData.published = data.published;
      updateData.publishedAt = data.published ? new Date() : null;
    }
    return this.prisma.db.newsPost.update({ where: { id }, data: updateData });
  }

  async deleteNews(id: string) {
    const post = await this.prisma.db.newsPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('News post not found');
    return this.prisma.db.newsPost.delete({ where: { id } });
  }

  // ---- Comments ----
  listComments(newsPostId: string) {
    return this.prisma.db.comment.findMany({
      where: { newsPostId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComment(newsPostId: string, data: { name: string; text: string }) {
    const post = await this.prisma.db.newsPost.findUnique({ where: { id: newsPostId } });
    if (!post) throw new NotFoundException('News post not found');
    return this.prisma.db.comment.create({
      data: {
        newsPostId,
        name: data.name,
        text: data.text,
      },
    });
  }

  async updateComment(id: string, data: { name?: string; text?: string }) {
    const comment = await this.prisma.db.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.text !== undefined) updateData.text = data.text;
    return this.prisma.db.comment.update({ where: { id }, data: updateData });
  }

  async deleteComment(id: string) {
    const comment = await this.prisma.db.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    return this.prisma.db.comment.delete({ where: { id } });
  }

  // ---- Events ----
  listEvents(schoolId: string | null) {
    return this.prisma.db.event.findMany({
      where: schoolId ? { schoolId } : {},
      orderBy: { startsAt: 'asc' },
      take: 100,
    });
  }

  createEvent(
    schoolId: string | null,
    data: {
      title: string;
      description?: string;
      location?: string;
      startsAt: string;
      endsAt?: string;
      coverUrl?: string;
    },
  ) {
    return this.prisma.db.event.create({
      data: {
        schoolId: schoolId ?? '',
        title: data.title,
        description: data.description,
        location: data.location,
        startsAt: new Date(data.startsAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
        coverUrl: data.coverUrl,
      },
    });
  }

  async updateEvent(
    id: string,
    data: {
      title?: string;
      description?: string;
      location?: string;
      startsAt?: string;
      endsAt?: string;
      coverUrl?: string;
    },
  ) {
    const event = await this.prisma.db.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    const updateData: Record<string, any> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.startsAt !== undefined) updateData.startsAt = new Date(data.startsAt);
    if (data.endsAt !== undefined) updateData.endsAt = data.endsAt ? new Date(data.endsAt) : null;
    if (data.coverUrl !== undefined) updateData.coverUrl = data.coverUrl;
    return this.prisma.db.event.update({ where: { id }, data: updateData });
  }

  async deleteEvent(id: string) {
    const event = await this.prisma.db.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    return this.prisma.db.event.delete({ where: { id } });
  }

  // ---- Gallery ----
  listGallery(schoolId: string | null, album?: string) {
    const where: Record<string, any> = {};
    if (schoolId) where.schoolId = schoolId;
    if (album) where.album = album;
    return this.prisma.db.galleryItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  createGalleryItem(
    schoolId: string | null,
    data: { url: string; type?: string; caption?: string; album?: string },
  ) {
    return this.prisma.db.galleryItem.create({
      data: {
        schoolId: schoolId ?? '',
        url: data.url,
        type: (data.type as any) ?? 'IMAGE',
        caption: data.caption,
        album: data.album,
      },
    });
  }

  async updateGalleryItem(
    id: string,
    schoolId: string,
    data: { url?: string; type?: string; caption?: string; album?: string },
  ) {
    const item = await this.prisma.db.galleryItem.findUnique({ where: { id } });
    if (!item || item.schoolId !== schoolId) {
      throw new NotFoundException('Gallery item not found');
    }
    return this.prisma.db.galleryItem.update({
      where: { id },
      data: {
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.type !== undefined ? { type: data.type as any } : {}),
        ...(data.caption !== undefined ? { caption: data.caption } : {}),
        ...(data.album !== undefined ? { album: data.album } : {}),
      },
    });
  }

  async deleteGalleryItem(id: string, schoolId: string) {
    const item = await this.prisma.db.galleryItem.findUnique({ where: { id } });
    if (!item || item.schoolId !== schoolId) {
      throw new NotFoundException('Gallery item not found');
    }
    return this.prisma.db.galleryItem.delete({ where: { id } });
  }

  // ---- File uploads ----

  /** Upload a file to Cloudinary and return the hosted URL. */
  async uploadMedia(file: Buffer, folder = 'goinzeschool/cms') {
    return this.cloudinary.uploadImage(file, folder);
  }
}
