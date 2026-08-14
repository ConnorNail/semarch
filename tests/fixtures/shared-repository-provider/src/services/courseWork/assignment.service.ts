import {
  assignmentRepository,
  assignmentSubmissionRepository,
  courseRepository,
} from "src/repositories/repositories.ts";

export class AssignmentService {
  public execute(): void {
    assignmentRepository.save();
    assignmentSubmissionRepository.save();
    courseRepository.save();
  }
}
