import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import schema from "../schema";

/**
 * Convex Auth optional fields are typed as `T | undefined`, which fails the
 * GenericDataModel constraint when used alone. Intersecting with
 * GenericDataModel satisfies ctx generics while preserving table document types.
 */
type SchemaDataModel = DataModelFromSchemaDefinition<typeof schema>;
export type DataModel = GenericDataModel & SchemaDataModel;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;

export type AuthUserDoc = DocumentByName<DataModel, "users">;
export type EventConfigDoc = DocumentByName<DataModel, "eventConfig">;
export type ApplicationDoc = DocumentByName<DataModel, "applications">;
export type ResumeUploadSessionDoc = DocumentByName<DataModel, "resumeUploadSessions">;
