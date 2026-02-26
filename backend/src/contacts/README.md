# Clients Module

## Quick Reference

**Module Location:** `backend/src/clients/`

**API Base URL:** `/api/v1/clients`

**Authentication:** JWT Bearer token required

---

## Files

- `clients.module.ts` - Module configuration
- `clients.controller.ts` - API endpoints (9 routes)
- `clients.service.ts` - Business logic with audit logging
- `dto/create-client.dto.ts` - Create validation
- `dto/update-client.dto.ts` - Update validation
- `dto/invite-client.dto.ts` - Portal invitation

---

## Quick Start

### Import in another module:

```typescript
import { ClientsModule } from '../clients/clients.module';

@Module({
  imports: [ClientsModule],
  // ...
})
export class SomeOtherModule {}
```

### Use the service:

```typescript
import { ClientsService } from '../clients/clients.service';

@Injectable()
export class SomeService {
  constructor(private clientsService: ClientsService) {}

  async doSomething() {
    const client = await this.clientsService.findOne('client-id');
    const clients = await this.clientsService.findAll({ skip: 0, take: 10 });
    const billing = await this.clientsService.getClientBillingSummary('client-id');
  }
}
```

---

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/clients` | Create client | ADMIN, MANAGER, ACCOUNTANT |
| GET | `/clients` | List clients | All |
| GET | `/clients/stats` | Get statistics | All |
| GET | `/clients/:id` | Get client | All |
| PATCH | `/clients/:id` | Update client | ADMIN, MANAGER, ACCOUNTANT |
| DELETE | `/clients/:id` | Delete client | ADMIN, MANAGER |
| GET | `/clients/:id/cases` | Get client cases | All |
| GET | `/clients/:id/billing` | Get billing summary | All |
| POST | `/clients/:id/invite` | Invite to portal | ADMIN, MANAGER, ACCOUNTANT |

---

## Service Methods

```typescript
// Create
create(createClientDto: CreateClientDto, createdById: string): Promise<Client>

// Read
findAll(params?: { skip?, take?, search?, isActive? }): Promise<{ data, total, skip, take }>
findOne(id: string): Promise<Client>
getClientStats(): Promise<{ topClients, totalClients }>

// Update
update(id: string, updateClientDto: UpdateClientDto, userId: string): Promise<Client>

// Delete (soft)
remove(id: string, userId: string): Promise<Client>

// Relationships
findClientCases(id: string, params?: { skip?, take? }): Promise<{ data, total, skip, take }>
getClientBillingSummary(id: string): Promise<{ totalBilled, totalPaid, outstanding, casesCount, cases }>

// Portal
inviteToPortal(clientId: string): Promise<{ invitationToken, invitationUrl, emailSent, emailMessage }>
```

---

## Example Usage

### Create a client:

```bash
curl -X POST http://localhost:3101/api/v1/clients \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "555-123-4567",
    "company": "Acme Corp"
  }'
```

### List clients with search:

```bash
curl -X GET "http://localhost:3101/api/v1/clients?search=acme&skip=0&take=20" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get client billing:

```bash
curl -X GET http://localhost:3101/api/v1/clients/{CLIENT_ID}/billing \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Validation Rules

**Required Fields:**
- `firstName` (1-100 chars)
- `lastName` (1-100 chars)
- `email` (valid email, max 255 chars, unique)

**Optional Fields:**
- `phone` (max 20 chars)
- `company` (max 255 chars)
- `address` (max 500 chars)
- `city` (max 100 chars)
- `state` (2 chars)
- `zipCode` (max 10 chars)
- `taxId` (max 50 chars)
- `notes` (max 1000 chars)
- `isActive` (boolean, default: true)

---

## Audit Logging

All CREATE, UPDATE, and DELETE operations are automatically logged to the `audit_logs` table with:
- User ID (who performed the action)
- Action type (CREATE, UPDATE, DELETE)
- Resource ("Client")
- Resource ID (client UUID)
- Details (relevant data)
- Timestamp

---

## Error Handling

- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing/invalid JWT
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Client not found
- `409 Conflict` - Duplicate email

---

## Database Schema

```prisma
model Client {
  id                  String    @id @default(uuid())
  firstName           String
  lastName            String
  email               String    @unique
  phone               String?
  company             String?
  address             String?
  city                String?
  state               String?
  zipCode             String?
  taxId               String?
  notes               String?
  isActive            Boolean   @default(true)
  portalAccessEnabled Boolean   @default(false)
  userId              String?   @unique
  invitationSentAt    DateTime?
  invitationToken     String?   @unique
  createdById         String
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  cases      Case[]
  createdBy  User   @relation("ClientCreator", fields: [createdById], references: [id])
  user       User?  @relation("ClientPortalUser", fields: [userId], references: [id])
}
```

---

## Testing

### Run tests:
```bash
npm run test             # Unit tests
npm run test:e2e         # E2E tests
npm run test:cov         # Coverage report
```

### Check TypeScript:
```bash
npx tsc --noEmit
```

### Build:
```bash
npm run build
```

---

## Documentation

- **API Reference:** `/backend/CLIENTS_API.md`
- **Implementation Summary:** `/backend/IMPLEMENTATION_SUMMARY.md`
- **Swagger UI:** http://localhost:3101/api/v1/docs

---

**Module Status:** ✅ Production Ready

**Last Updated:** October 9, 2025
