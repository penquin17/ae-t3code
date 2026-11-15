// AETHERIA M07 Plan step 22 — the one import site of the pinned `@aetheria/workflows` archive, through its Backend entry. Every other module under `workflows/` takes the ledger's names from here, so a
// test can check that no other file reaches the archive and that no outer-source path is used.
export {
  WORKFLOW_OPERATIONS,
  createWorkflowOperations,
  openWorkflowLedger,
} from "@aetheria/workflows/backend";
export type {
  LedgerResult,
  WorkflowAnswer,
  WorkflowAuthorization as WorkflowRunAuthorization,
  WorkflowLedger,
  WorkflowOperation,
  WorkflowOperationContext,
} from "@aetheria/workflows/backend";
