import { BillingService } from "../../billing";

export class UserService {
  public constructor(private readonly billing: BillingService) {}
}
