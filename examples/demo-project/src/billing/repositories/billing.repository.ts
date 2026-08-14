export class BillingRepository {
  public audit(name: string): void {
    console.log(`Auditing billing account for ${name}`);
  }
}
