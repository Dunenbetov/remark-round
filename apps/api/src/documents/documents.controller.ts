import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Get()
  @Roles('admin', 'pm', 'business')
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

  @Get(':documentId')
  get(@Ctx() ctx: ProjectContext, @Param('documentId') documentId: string): Promise<DocumentSummary> {
    return this.documents.get(ctx, documentId);
  }

  @Post(':documentId/reindex')
  @Roles('admin')
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
