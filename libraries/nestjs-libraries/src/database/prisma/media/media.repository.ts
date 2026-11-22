import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';

@Injectable()
export class MediaRepository {
  constructor(
    private _media: PrismaRepository<'media'>,
    private _post: PrismaRepository<'post'>,
    private _sets: PrismaRepository<'sets'>,
    private _signatures: PrismaRepository<'signatures'>
  ) {}

  saveFile(org: string, fileName: string, filePath: string, originalName?: string) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
      },
    });
  }

  startProcessing(org: string, id: string) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { status: 'processing', processingError: null },
      select: { id: true, status: true },
    });
  }

  finishProcessing(
    org: string,
    id: string,
    data: { name?: string; path?: string; fileSize?: number; error?: string }
  ) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.path ? { path: data.path } : {}),
        ...(data.fileSize ? { fileSize: data.fileSize } : {}),
        status: data.error ? 'failed' : 'ready',
        processingError: data.error || null,
      },
      select: { id: true, status: true },
    });
  }

  // One page of the media old enough for the retention sweep, oldest id first.
  // A file picked as an avatar, an agency logo or an app picture is never swept
  getMediaForRetention(createdBefore: Date, lastId?: string) {
    return this._media.model.media.findMany({
      where: {
        deletedAt: null,
        status: 'ready',
        createdAt: { lte: createdBefore },
        userPicture: { none: {} },
        agencies: { none: {} },
        oauthApps: { none: {} },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: {
        id: true,
        organizationId: true,
        path: true,
        thumbnail: true,
      },
    });
  }

  // The posts (and their comments) that attach this file, in their media or
  // in their settings (YouTube thumbnail, article covers)
  getPostsUsingMedia(org: string, path: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        OR: [{ image: { contains: path } }, { settings: { contains: path } }],
      },
      select: {
        state: true,
        publishDate: true,
        intervalInDays: true,
      },
    });
  }

  // Sets and signatures are reused for new posts, a file they hold stays
  async isMediaInReusableContent(org: string, path: string) {
    const [sets, signatures] = await Promise.all([
      this._sets.model.sets.count({
        where: { organizationId: org, content: { contains: path } },
      }),
      this._signatures.model.signatures.count({
        where: {
          organizationId: org,
          deletedAt: null,
          content: { contains: path },
        },
      }),
    ]);
    return sets + signatures > 0;
  }

  getMediaStatus(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
        processingError: true,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, page: number, search?: string) {
    const pageNum = (page || 1) - 1;
    const trimmedSearch = search?.trim();
    const searchFilter = trimmedSearch
      ? {
          originalName: {
            contains: trimmedSearch,
            mode: 'insensitive' as const,
          },
        }
      : {};
    const query = {
      where: {
        organization: {
          id: org,
        },
        deletedAt: null,
        status: { not: 'processing' },
        ...searchFilter,
      },
    };
    const pages = Math.ceil((await this._media.model.media.count(query)) / 18);
    const results = await this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        // still being normalized: it shows up once the workflow releases it
        status: { not: 'processing' },
        ...searchFilter,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        createdAt: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }
}
