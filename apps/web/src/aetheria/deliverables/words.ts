// Plain lines for the codes the deliverables contracts carry (M10 Plan step 16, D14). A line says what the code's meaning is; the Backend's own message is shown beside it, verbatim, by the view, and
// an unknown code has no line here, so its words stand alone. The records are typed by the contracts' own code types, so a code removed there does not compile and a code added there fails the
// coverage test. None of these lines claims that nothing changed: a read changes nothing by itself, and a refused download only says what was refused.
import type {
  DeliverableDownloadRefusalCode,
  DeliverableSnapshotFailureCode,
  DeliverablesClientCode,
} from "@t3tools/aetheria-contracts";

export const CLIENT_CODE_LINES: Record<DeliverablesClientCode, string> = {
  DELIVERABLES_NOT_AUTHORIZED:
    "This device is not allowed to read the deliverables of this session.",
  DELIVERABLES_DEVICE_REVOKED:
    "This device's access was revoked, so the deliverables cannot be read.",
  DELIVERABLES_NOT_FOUND: "The Backend has no such session to list deliverables for.",
  DELIVERABLES_UNAVAILABLE: "The Backend could not answer the deliverables request.",
  DELIVERABLES_STORE_UNUSABLE: "The Backend's deliverables store cannot be used right now.",
  DELIVERABLES_FORMAT_NEWER:
    "The deliverables store was written by a newer version, so it is not read.",
};

export const DOWNLOAD_CODE_LINES: Record<DeliverableDownloadRefusalCode, string> = {
  DOWNLOAD_BEARER_REQUIRED:
    "The request carried no credential (a Bearer header or this page's signed-in session), so the Backend refused it.",
  DOWNLOAD_UNAUTHENTICATED:
    "The Backend does not accept this device's credential (expired, revoked or unknown).",
  DOWNLOAD_NOT_AUTHORIZED: "This device is not allowed to download files from this session.",
  DOWNLOAD_BAD_REQUEST: "The Backend could not read the download request.",
  DOWNLOAD_NOT_FOUND: "The Backend does not offer a file under that id for this device.",
  DOWNLOAD_OFFERED_UNKNOWN: "The Backend no longer records that path as edited in this session.",
  DOWNLOAD_SNAPSHOT_PENDING:
    "The as-delivered copy is not settled yet, so it cannot be downloaded.",
  DOWNLOAD_SNAPSHOT_UNAVAILABLE: "No as-delivered copy was kept for this file.",
  DOWNLOAD_SNAPSHOT_MISSING: "The as-delivered copy is recorded but its stored bytes are missing.",
  DOWNLOAD_SNAPSHOT_MISMATCH:
    "The stored copy no longer matches the digest declared for it, so it was not served.",
  DOWNLOAD_FILE_MISSING: "The file is no longer where it was delivered.",
  DOWNLOAD_FILE_NOT_REGULAR: "The path is no longer a regular file, so it was not served.",
  DOWNLOAD_FILE_OUTSIDE_ROOT:
    "The path now resolves outside the session's working folder, so it was not served.",
  DOWNLOAD_FILE_UNREADABLE: "The Backend cannot read the file right now.",
  DOWNLOAD_FILE_CHANGED: "The file changed while the Backend was opening it, so it was not served.",
  DOWNLOAD_TOO_LARGE: "The file is larger than the Backend serves in one download.",
  DOWNLOAD_UNAVAILABLE: "The Backend's download service is not available.",
};

export const SNAPSHOT_FAILURE_LINES: Record<DeliverableSnapshotFailureCode, string> = {
  SNAPSHOT_CHANGED: "the file changed while the copy was being taken",
  SNAPSHOT_NOT_REGULAR: "the path was not a regular file when the copy was taken",
  SNAPSHOT_TOO_LARGE: "the file is too large to keep a copy of",
  ATTACHMENT_MISSING: "the stored copy is missing",
  unavailable: "the copy store could not be used",
};

const tables: readonly Readonly<Record<string, string>>[] = [
  CLIENT_CODE_LINES,
  DOWNLOAD_CODE_LINES,
  SNAPSHOT_FAILURE_LINES,
];

/** The line for a code, or nothing for a code this build does not know (own keys only: `constructor` is not a code). */
export function lineForCode(code: string): string | undefined {
  for (const table of tables) {
    if (Object.hasOwn(table, code)) return table[code];
  }
  return undefined;
}
