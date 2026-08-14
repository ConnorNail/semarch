import { BillingRepository } from "../repositories/billing.repository";

export class BillingService {
  public constructor(private readonly billing = new BillingRepository()) {}

  public recordNewCustomer(name: string): void {
    this.billing.audit(name);
  }
}
