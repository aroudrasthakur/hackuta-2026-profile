import { cronJobs } from "convex/server";
import { makeFunctionReference } from "convex/server";

const crons = cronJobs();

crons.interval(
  "delete expired unassociated resume uploads",
  { minutes: 15 },
  makeFunctionReference<"mutation">("resumeUploads:cleanupExpiredUploadSessions"),
  {},
);

export default crons;
