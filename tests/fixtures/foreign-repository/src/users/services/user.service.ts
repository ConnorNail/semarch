import { BillingRepository } from "../../billing/repositories/billing.repository";

export class UserService {
  public constructor(private readonly billing: BillingRepository) {}
}
