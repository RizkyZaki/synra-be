import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertStatus, AuditAction } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { alertCode } from '../notifications/alert-message';
import { ADMIN_ROLE_CODE } from '../../common/permissions';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES_PER_UPLOAD = 5;
const ATTACHMENT_MAX_PER_ALERT = 20;

/** Ekstensi yang diterima → MIME yang disimpan. MIME dari browser tidak dipercaya. */
const TYPES: Record<string, { mime: string; magic?: (b: Buffer) => boolean }> = {
  '.png': { mime: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.webp': { mime: 'image/webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  '.pdf': { mime: 'application/pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  '.txt': { mime: 'text/plain' },
  '.log': { mime: 'text/plain' },
  '.csv': { mime: 'text/csv' },
};

export const isAllowedAttachment = (name: string) => extname(name).toLowerCase() in TYPES;

/** Lampiran bukti remediasi, disimpan di disk (UPLOAD_DIR) dengan nama acak. */
@Injectable()
export class AlertAttachmentsService {
  private readonly dir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR', './uploads'), 'alerts');
  }

  async upload(alertId: string, files: Express.Multer.File[] | undefined, actor: AuthUser, meta: RequestMeta) {
    if (!files?.length) throw new BadRequestException(MSG.ATTACHMENT_REQUIRED);
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId }, include: { _count: { select: { attachments: true } } } });
    if (!alert) throw new NotFoundException(MSG.ALERT_NOT_FOUND);
    if (alert.status === AlertStatus.CLOSED) throw new BadRequestException(MSG.ATTACHMENT_CLOSED);
    if (alert._count.attachments + files.length > ATTACHMENT_MAX_PER_ALERT) {
      throw new BadRequestException(MSG.ATTACHMENT_LIMIT(ATTACHMENT_MAX_PER_ALERT));
    }

    // Validasi semua file dulu agar tidak ada yang tersimpan setengah jalan.
    const prepared = files.map((f) => {
      const fileName = safeName(f.originalname);
      const ext = extname(fileName).toLowerCase();
      const type = TYPES[ext];
      if (!type) throw new BadRequestException(MSG.ATTACHMENT_TYPE);
      const ok = type.magic ? type.magic(f.buffer) : isText(f.buffer);
      if (!ok) throw new BadRequestException(MSG.ATTACHMENT_CONTENT(fileName));
      return { file: f, fileName, mime: type.mime, key: `${randomUUID()}${ext}`, sha256: createHash('sha256').update(f.buffer).digest('hex') };
    });

    await mkdir(this.dir, { recursive: true });
    for (const p of prepared) await writeFile(resolve(this.dir, p.key), p.file.buffer, { flag: 'wx' });

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const p of prepared) {
        rows.push(
          await tx.alertAttachment.create({
            data: {
              alertId,
              fileName: p.fileName,
              mimeType: p.mime,
              sizeBytes: p.file.size,
              storageKey: p.key,
              sha256: p.sha256,
              uploadedById: actor.id,
              uploadedByName: actor.username,
            },
            select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, uploadedByName: true, createdAt: true },
          }),
        );
      }
      await this.audit.log(
        {
          action: AuditAction.ALERT_ATTACHMENT_UPLOAD,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'Alert',
          entityId: alertId,
          after: { code: alertCode(alert.number), files: rows.map((r) => ({ fileName: r.fileName, sizeBytes: r.sizeBytes, sha256: r.sha256 })) },
          meta,
        },
        tx,
      );
      return rows;
    });
    return created;
  }

  async download(alertId: string, attachmentId: string) {
    const a = await this.prisma.alertAttachment.findFirst({ where: { id: attachmentId, alertId } });
    if (!a) throw new NotFoundException(MSG.ATTACHMENT_NOT_FOUND);
    const inline = a.mimeType.startsWith('image/') || a.mimeType === 'application/pdf';
    return new StreamableFile(createReadStream(resolve(this.dir, a.storageKey)), {
      type: a.mimeType,
      length: a.sizeBytes,
      disposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
    });
  }

  async remove(alertId: string, attachmentId: string, actor: AuthUser, _meta: RequestMeta) {
    if (actor.roleCode !== ADMIN_ROLE_CODE) {
      throw new ForbiddenException('Hanya Administrator yang dapat menghapus lampiran bukti remediasi.');
    }

    const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException(MSG.ALERT_NOT_FOUND);
    if (alert.status === AlertStatus.CLOSED) {
      throw new BadRequestException('Alert yang sudah ditutup tidak dapat diubah lampirannya.');
    }

    const attachment = await this.prisma.alertAttachment.findFirst({
      where: { id: attachmentId, alertId },
    });
    if (!attachment) throw new NotFoundException(MSG.ATTACHMENT_NOT_FOUND);

    await this.prisma.alertAttachment.delete({ where: { id: attachmentId } });
    await unlink(resolve(this.dir, attachment.storageKey)).catch(() => undefined);

    return { success: true, message: 'Lampiran berhasil dihapus.', id: attachmentId };
  }
}

/** Nama file tampilan: tanpa path dan karakter kontrol, maksimal 120 karakter. */
function safeName(name: string): string {
  // Multer membaca nama file sebagai latin1; ubah ke UTF-8 agar nama berhuruf non-ASCII tidak rusak.
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  const base = utf8.split(/[\\/]/).pop() ?? 'lampiran';
  const cleaned = base.replace(/[\x00-\x1f\x7f"]/g, '').trim();
  if (cleaned.length <= 120) return cleaned || 'lampiran';
  const ext = extname(cleaned);
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/** File teks: tidak mengandung byte NUL di 8 KB pertama. */
function isText(b: Buffer): boolean {
  return !b.subarray(0, 8192).includes(0);
}
