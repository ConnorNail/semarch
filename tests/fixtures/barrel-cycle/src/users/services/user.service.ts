import { BillingRepository } from "../../billing";

export class UserService {
  public constructor(private readonly billing: BillingRepository) {}
}
