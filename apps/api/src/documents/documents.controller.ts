import {
  Body,
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
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { DocumentsService, DocumentSummary } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

@Controller('projects/:projectId/documents')
@UseGuards(MembershipGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Пакет читает вся команда, включая разработчика: ТЗ и протокол — их рабочие документы (замечание владельца 20.09). */
  @Get()
  list(@Ctx() ctx: ProjectContext): Promise<DocumentSummary[]> {
    return this.documents.list(ctx);
  }

  /** multipart/form-data: поле `file`, плюс `kind` и необязательный `effectiveAt`. */
  @Post()
  @Roles('admin', 'pm')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(
    @Ctx() ctx: ProjectContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<DocumentSummary> {
    if (!file) throw new UnprocessableEntityException('Нужен файл в поле file');
    return this.documents.upload(ctx, {
      kind: dto.kind,
      fileName: decodeFileName(file.originalname),
      mime: file.mimetype,
      data: file.buffer,
      effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
    });
  }

  /** Мета и статус индекса одного документа: фронт берёт список, но спеки и MCP-клиенты читают по id. */
  @Get(':documentId')
  get(@Ctx() ctx: ProjectContext, @Param('documentId') documentId: string): Promise<DocumentSummary> {
    return this.documents.get(ctx, documentId);
  }

  /**
   * Файл как загрузили — скачать, а не открыть: у DOCX и PDF в браузере всё равно нет просмотра, а CSP с sandbox
   * не даст исполниться скрипту внутри чужого файла. Имя по RFC 5987, кириллица в Content-Disposition не ломается.
   */
  @Get(':documentId/file')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async file(@Ctx() ctx: ProjectContext, @Param('documentId') documentId: string): Promise<StreamableFile> {
    const f = await this.documents.file(ctx, documentId);
    try {
      await stat(f.path);
    } catch {
      throw new NotFoundException();
    }
    const name = encodeURIComponent(f.title);
    return new StreamableFile(createReadStream(f.path), { type: f.mime, disposition: `attachment; filename="${name}"; filename*=UTF-8''${name}` });
  }

  @Post(':documentId/reindex')
  @Roles('admin', 'pm')
  @HttpCode(202)
  reindex(@Ctx() ctx: ProjectContext, @Param('documentId') documentId: string): Promise<DocumentSummary> {
    return this.documents.reindex(ctx, documentId);
  }
}

/** multer отдаёт имя в latin1; кириллические имена файлов иначе превращаются в кракозябры. */
function decodeFileName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}
