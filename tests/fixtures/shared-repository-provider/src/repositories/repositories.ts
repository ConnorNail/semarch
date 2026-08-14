import { Neo4jAssignmentRepository } from "./assignment.repository";
import { Neo4jAssignmentSubmissionRepository } from "./assignment-submission.repository";
import { Neo4jCourseRepository } from "./course.repository";

export const assignmentRepository = new Neo4jAssignmentRepository();
export const assignmentSubmissionRepository = new Neo4jAssignmentSubmissionRepository();
export const courseRepository = new Neo4jCourseRepository();
