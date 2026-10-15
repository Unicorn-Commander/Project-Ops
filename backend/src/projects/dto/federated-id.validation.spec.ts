import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDto } from './update-project.dto';
import { ListProjectsDto } from './list-projects.dto';

const CUSTOMER_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const PROJECT_WRITE_DTOS: ClassConstructor<object>[] = [CreateProjectDto, UpdateProjectDto];

describe('project federated id DTO validation', () => {
  it('accepts UUID filters on the REST list DTO', async () => {
    const errors = await validate(
      plainToInstance(ListProjectsDto, {
        customerOpsCustomerId: CUSTOMER_ID,
        contactOpsContactId: CONTACT_ID,
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects malformed REST list filters with field-specific validation errors', async () => {
    const errors = await validate(
      plainToInstance(ListProjectsDto, {
        customerOpsCustomerId: 'customer-not-a-uuid',
        contactOpsContactId: 'contact-not-a-uuid',
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['customerOpsCustomerId', 'contactOpsContactId']),
    );
  });

  it.each(PROJECT_WRITE_DTOS)(
    'rejects malformed write ids on %p with field-specific validation errors',
    async (Dto) => {
      const errors = await validate(
        plainToInstance(Dto, {
          title: 'Project',
          clientName: 'Client',
          customerOpsCustomerId: 'customer-not-a-uuid',
          contactOpsContactId: 'contact-not-a-uuid',
        }),
      );

      expect(errors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['customerOpsCustomerId', 'contactOpsContactId']),
      );
    },
  );

  it('keeps null clearing valid on create and update DTOs', async () => {
    for (const Dto of PROJECT_WRITE_DTOS) {
      const errors = await validate(
        plainToInstance(Dto, {
          title: 'Project',
          clientName: 'Client',
          customerOpsCustomerId: null,
          contactOpsContactId: null,
        }),
      );

      expect(errors.filter((error) => error.property.includes('Ops'))).toHaveLength(0);
    }
  });
});
