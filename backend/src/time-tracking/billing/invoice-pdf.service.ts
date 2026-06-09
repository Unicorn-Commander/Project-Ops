import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { MinioService } from '../../documents/minio.service';
import { AssembledDraft } from './billable-draft.assembler';

export interface DraftPdfHeader {
  fromName: string;
  customerName: string;
  customerEmail?: string | null;
  projectLabel?: string | null;
  periodLabel?: string | null;
  externalRef: string;
}

/**
 * Renders the billable draft as a "DRAFT INVOICE" PDF and stores it via the
 * existing object store (Garage/MinIO). This is the preview shown when the
 * workspace is not (yet) entitled to invoice through Accounting-Ops.
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(private readonly minio: MinioService) {}

  async renderAndStore(
    workspaceId: string,
    draft: AssembledDraft,
    header: DraftPdfHeader,
  ): Promise<{ objectKey: string; previewUrl: string }> {
    const pdf = await this.render(draft, header);
    const objectKey = `time-tracking/drafts/${workspaceId}/${this.safe(header.externalRef)}.pdf`;
    await this.minio.uploadObject(objectKey, pdf, pdf.length, {
      'Content-Type': 'application/pdf',
    });
    const previewUrl = await this.minio.getPresignedDownloadUrl(objectKey, 7 * 24 * 3600);
    this.logger.log(`Draft invoice PDF stored: ${objectKey}`);
    return { objectKey, previewUrl };
  }

  private safe(ref: string): string {
    return ref.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private render(draft: AssembledDraft, header: DraftPdfHeader): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(22).text('DRAFT INVOICE', { align: 'right' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#888').text('Not yet issued — preview only', { align: 'right' });
        doc.fillColor('#000');

        doc.moveDown(1);
        doc.fontSize(11).text(header.fromName, { continued: false });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#555').text('Bill to:');
        doc.fillColor('#000').fontSize(11).text(header.customerName);
        if (header.customerEmail) doc.fontSize(10).fillColor('#555').text(header.customerEmail);
        doc.fillColor('#000');

        doc.moveDown(0.5);
        if (header.projectLabel) doc.fontSize(10).text(`Project: ${header.projectLabel}`);
        if (header.periodLabel) doc.fontSize(10).text(`Period: ${header.periodLabel}`);
        doc.fontSize(8).fillColor('#aaa').text(`Ref: ${header.externalRef}`);
        doc.fillColor('#000');

        doc.moveDown(1);
        // Table header
        const startX = 50;
        let y = doc.y;
        doc.fontSize(10).fillColor('#000');
        doc.text('Description', startX, y, { width: 250 });
        doc.text('Qty', 310, y, { width: 60, align: 'right' });
        doc.text('Rate', 375, y, { width: 80, align: 'right' });
        doc.text('Amount', 460, y, { width: 90, align: 'right' });
        y += 16;
        doc.moveTo(startX, y).lineTo(560, y).strokeColor('#ccc').stroke();
        y += 6;

        for (const li of draft.lineItems) {
          const desc = li.description || 'Work';
          const descHeight = doc.heightOfString(desc, { width: 250 });
          doc.fontSize(9);
          doc.text(desc, startX, y, { width: 250 });
          doc.text(li.quantity, 310, y, { width: 60, align: 'right' });
          doc.text(`${draft.currency} ${li.unitPrice}`, 375, y, { width: 80, align: 'right' });
          doc.text(`${draft.currency} ${li.amount}`, 460, y, { width: 90, align: 'right' });
          y += Math.max(descHeight, 12) + 6;
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
        }

        doc.moveTo(startX, y).lineTo(560, y).strokeColor('#ccc').stroke();
        y += 10;
        doc.fontSize(12).text('Total', 375, y, { width: 80, align: 'right' });
        doc.text(`${draft.currency} ${draft.total}`, 460, y, { width: 90, align: 'right' });

        doc.end();
      } catch (err) {
        reject(err as Error);
      }
    });
  }
}
