import {
  billingRepository,
  inventoryRepository,
  userRepository,
} from "@app/repositories/repository-provider.ts";

export class UserService {
  public execute(): void {
    billingRepository.save();
    inventoryRepository.save();
    userRepository.save();
  }
}
