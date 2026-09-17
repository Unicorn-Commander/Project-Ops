import { IsOptional, IsBoolean } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateDocumentDto } from './create-document.dto';

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {
  @IsOptional()
  @IsBoolean()
  isClientVisible?: boolean;
}
