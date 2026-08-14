import { UserRepository } from "../repositories/user.repository";
import { BillingService } from "../../billing/services/billing.service";

export class UserService {
  public constructor(
    private readonly users: UserRepository,
    private readonly billing: BillingService,
  ) {}
}
