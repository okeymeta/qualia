import { internal } from "./_generated/api";
import { cronJobs } from "convex/server";

const crons = cronJobs();

crons.cron(
  "country close ai reviews",
  "5 * * * *",
  internal.scheduler.runCountryReviewWindow,
  {},
);

export default crons;
