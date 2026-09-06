import {
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { StorageService } from '../storage/storage.service';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
const FILE_NAME = /^[a-f0-9-]{36}\.[a-z0-9]{1,5}$/;

export interface MediaUploadResult {
  storageKey: string;
  url: string;
}

/** Ключ хранилища всегда `<projectId>/<uuid>.<ext>`, поэтому URL кадра не выходит за проект. */
export function mediaUrl(projectId: string, storageKey: string): string {
  return `/api/v1/projects/${projectId}/media/${storageKey.slice(projectId.length + 1)}`;
}

/** Скрины: загрузка отдельно от замечания (docs/API.md), отдача только участникам проекта. */
@Controller('projects/:projectId/media')
@UseGuards(MembershipGuard, RolesGuard)
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @Roles('business', 'pm', 'admin', 'developer')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async upload(@Ctx() ctx: ProjectContext, @UploadedFile() file: Express.Multer.File | undefined): Promise<MediaUploadResult> {
    if (!file || !file.buffer.length) throw new UnprocessableEntityException('Нужен файл в поле file');
    const ext = extname(file.originalname).toLowerCase();
    // SVG больше не принимаем: pixelmatch его не сравнивает, а скрипт внутри — лишний риск (фаза 11)
    if (!IMAGE_MIME[ext] || ext === '.svg') throw new UnprocessableEntityException('Скрин: PNG, JPG, WebP или GIF');
    const storageKey = await this.storage.save(ctx.projectId, file.originalname, file.buffer);
    return { storageKey, url: mediaUrl(ctx.projectId, storageKey) };
  }

  /** Кадр отдаётся как картинка, не как документ: скрипту внутри старого SVG негде выполниться. */
  @Get(':fileName')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Header('X-Content-Type-Options', 'nosniff')
  async get(@Ctx() ctx: ProjectContext, @Param('fileName') fileName: string): Promise<StreamableFile> {
    if (!FILE_NAME.test(fileName)) throw new NotFoundException();
    const path = join(this.storage.root, ctx.projectId, fileName);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException();
    }
    const ext = extname(fileName);
    const type = IMAGE_MIME[ext] ?? 'application/octet-stream';
    return new StreamableFile(createReadStream(path), { type, disposition: ext === '.svg' ? 'attachment' : undefined });
  }
}
