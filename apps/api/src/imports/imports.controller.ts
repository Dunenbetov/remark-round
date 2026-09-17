import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MembershipGuard } from '../tenancy/membership.guard';
import { Ctx, ProjectContext } from '../tenancy/project-context';
import { Roles, RolesGuard } from '../tenancy/roles';
import { CreateImportDto, ImportJobView } from './import.dto';
import { ImportService } from './imports.service';
import { TEMPLATE_CSV, XLSX_MIME, buildTemplateXlsx } from './journal-template';

/** Потолок файла журнала: IMPORT_MAX_BYTES (20 МБ; на бете 5 МБ — xlsx с картинками разбирается в памяти запроса, R-H3). */
const MAX_JOURNAL_BYTES = Number(process.env['IMPORT_MAX_BYTES'] ?? 20 * 1024 * 1024);

/** docs/API.md: импорт шаблона журнала, статус разбора, скачивание шаблона. */
@Controller('projects/:projectId/imports')
@UseGuards(MembershipGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  /** «Скачать шаблон журнала»: пустой xlsx с шапкой и подсказками. */
  @Get('template.xlsx')
  @Header('Content-Disposition', 'attachment; filename="journal-template.xlsx"')
  async templateXlsx(): Promise<StreamableFile> {
    return new StreamableFile(await buildTemplateXlsx(), { type: XLSX_MIME });
  }

  @Get('template.csv')
  @Header('Content-Disposition', 'attachment; filename="journal-template.csv"')
  templateCsv(): StreamableFile {
    return new StreamableFile(Buffer.from(TEMPLATE_CSV, 'utf8'), { type: 'text/csv; charset=utf-8' });
  }

  /** multipart/form-data: `file` (.xlsx или .csv по шаблону) + `roundId`. */
  @Post()
  @Roles('business', 'pm')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_JOURNAL_BYTES } }))
  create(@Ctx() ctx: ProjectContext, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateImportDto): Promise<ImportJobView> {
    if (!file) throw new UnprocessableEntityException('Нужен файл в поле file');
    return this.imports.create(ctx, { roundId: dto.roundId, fileName: decodeFileName(file.originalname), data: file.buffer });
  }

  @Get(':jobId')
  get(@Ctx() ctx: ProjectContext, @Param('jobId') jobId: string): Promise<ImportJobView> {
    return this.imports.get(ctx, jobId);
  }
}

/** multer отдаёт имя в latin1; кириллические имена иначе превращаются в кракозябры. */
function decodeFileName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}
