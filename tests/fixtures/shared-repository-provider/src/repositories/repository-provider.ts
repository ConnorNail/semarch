import { BillingRepositoryImplementation } from "./billing.repository";
import { InventoryRepositoryImplementation } from "./inventory.repository";
import { UserRepositoryImplementation } from "./user.repository";

export const billingRepository = new BillingRepositoryImplementation();
export const inventoryRepository = new InventoryRepositoryImplementation();
export const userRepository = new UserRepositoryImplementation();
