import { BillingRepository, BillingService } from "../../billing";
import type { CreateUserRequest } from "../../transport/http/create-user.request";
import { UserRepository } from "../repositories/user.repository";

export class CreateUserService {
  public constructor(
    private readonly users: UserRepository,
    private readonly billing: BillingService,
    private readonly billingRepository: BillingRepository,
  ) {}

  public execute(request: CreateUserRequest): void {
    this.users.save(request.name);
    this.billing.recordNewCustomer(request.name);
    this.billingRepository.audit(request.name);
  }
}
